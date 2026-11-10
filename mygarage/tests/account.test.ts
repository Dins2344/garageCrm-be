import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../../app';
import { authHeader } from '../../tests/helpers/factories';
import { mgDb } from '../config/db';
import { users, refreshTokens, syncRecords, cloudFiles } from '../config/schema';
import { useMyGarageDb } from './harness';
import * as r2 from '../services/r2';

vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) =>
    idToken === 'other' ? { sub: 'g-2', email: 'b@example.com' } : { sub: 'g-1', email: 'a@example.com' })
}));
vi.mock('../services/r2', () => ({
  objectKey: (scope: string, fileId: string) => `${scope[0]}/${scope.slice(2)}/${fileId}`,
  presignPut: vi.fn(),
  presignGet: vi.fn(),
  headObjectSize: vi.fn(),
  deleteObject: vi.fn(async () => undefined)
}));

useMyGarageDb();

const F = ['1', '2', '3'].map((n) => `0190a1b2-c3d4-7e5f-8a6b-12345678900${n}`);
const sign = async (idToken = 'good') =>
  (await request(app).post('/api/mygarage/auth/google').send({ idToken })).body.data;
const del = (t: string) => request(app).delete('/api/mygarage/account').set(authHeader(t));
const seed = async (userId: string) => {
  await mgDb.insert(cloudFiles).values(F.map((fileId) => ({ scope: `u:${userId}`, ownerId: userId, fileId, size: 10, status: 'uploaded' as const })));
  await mgDb.insert(syncRecords).values({ scope: `u:${userId}`, writerId: userId, tbl: 'vehicles', id: 'v1', updatedAt: 1, payload: 'x' });
};
const counts = async (userId: string) => ({
  users: (await mgDb.select().from(users).where(eq(users.id, userId))).length,
  tokens: (await mgDb.select().from(refreshTokens).where(eq(refreshTokens.userId, userId))).length,
  sync: (await mgDb.select().from(syncRecords).where(eq(syncRecords.scope, `u:${userId}`))).length,
  files: (await mgDb.select().from(cloudFiles).where(eq(cloudFiles.ownerId, userId))).length
});

beforeEach(() => {
  vi.mocked(r2.deleteObject).mockReset().mockResolvedValue(undefined);
});

describe('MyGarage account deletion', () => {
  it("deletes everything the user owns and nothing of anyone else's", async () => {
    const a = await sign();
    const b = await sign('other');
    await seed(a.user.id);
    await seed(b.user.id);
    const res = await del(a.accessToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Account deleted' });
    expect(await counts(a.user.id)).toEqual({ users: 0, tokens: 0, sync: 0, files: 0 });
    expect(await counts(b.user.id)).toEqual({ users: 1, tokens: 1, sync: 1, files: 3 });
  });

  it('deletes every R2 object the user has', async () => {
    const a = await sign();
    await seed(a.user.id);
    await del(a.accessToken);
    const keys = vi.mocked(r2.deleteObject).mock.calls.map((c) => c[0]).sort();
    expect(keys).toEqual(F.map((f) => `u/${a.user.id}/${f}`).sort());
  });

  it('the access token stops working at once', async () => {
    const a = await sign();
    await del(a.accessToken);
    const res = await request(app).get('/api/mygarage/me').set(authHeader(a.accessToken));
    expect(res.status).toBe(401);
  });

  it('if an R2 delete fails, keeps the user and only the rows already deleted are gone', async () => {
    const a = await sign();
    await seed(a.user.id);
    vi.mocked(r2.deleteObject).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('boom'));
    const res = await del(a.accessToken);
    expect(res.status).toBe(502);
    expect(res.body.message).toBe('Could not delete your files. Try again.');
    const c = await counts(a.user.id);
    expect(c.users).toBe(1);
    expect(c.files).toBe(2);
  });

  it('a retry after a failure completes the deletion', async () => {
    const a = await sign();
    await seed(a.user.id);
    vi.mocked(r2.deleteObject).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('boom'));
    expect((await del(a.accessToken)).status).toBe(502);
    expect((await del(a.accessToken)).status).toBe(200);
    expect(await counts(a.user.id)).toEqual({ users: 0, tokens: 0, sync: 0, files: 0 });
  });

  it('with 25 files, deletes every object and every row', async () => {
    const a = await sign();
    const ids = Array.from({ length: 25 }, (_, n) => `0190a1b2-c3d4-7e5f-8a6b-${String(n).padStart(12, '0')}`);
    await mgDb.insert(cloudFiles).values(ids.map((fileId) => ({ scope: `u:${a.user.id}`, ownerId: a.user.id, fileId, size: 10, status: 'uploaded' as const })));
    expect((await del(a.accessToken)).status).toBe(200);
    expect(vi.mocked(r2.deleteObject)).toHaveBeenCalledTimes(25);
    expect(await counts(a.user.id)).toEqual({ users: 0, tokens: 0, sync: 0, files: 0 });
  });

  it('when one object in the second chunk fails, keeps the user and only that row', async () => {
    const a = await sign();
    const ids = Array.from({ length: 25 }, (_, n) => `0190a1b2-c3d4-7e5f-8a6b-${String(n).padStart(12, '0')}`);
    await mgDb.insert(cloudFiles).values(ids.map((fileId) => ({ scope: `u:${a.user.id}`, ownerId: a.user.id, fileId, size: 10, status: 'uploaded' as const })));
    // The 15th call is in the second chunk of 10, whatever order the rows come back in.
    let calls = 0;
    let bad = '';
    vi.mocked(r2.deleteObject).mockImplementation(async (key: string) => {
      if (++calls === 15) {
        bad = key;
        throw new Error('boom');
      }
    });
    const res = await del(a.accessToken);
    expect(res.status).toBe(502);
    expect((await counts(a.user.id)).users).toBe(1);
    const called = vi.mocked(r2.deleteObject).mock.calls.map((c) => c[0]);
    expect(called).toHaveLength(20);
    const deleted = called.filter((k) => k !== bad).map((k) => k.split('/')[2]);
    const left = (await mgDb.select({ fileId: cloudFiles.fileId }).from(cloudFiles).where(eq(cloudFiles.ownerId, a.user.id))).map((r) => r.fileId);
    expect(left.sort()).toEqual(ids.filter((id) => !deleted.includes(id)).sort());
    expect(left).toHaveLength(6);
  });
});
