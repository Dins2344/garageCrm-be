import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import app from '../../app';
import { authHeader } from '../../tests/helpers/factories';
import { testDb, useMyGarageDb } from './harness';
import { cloudFiles, garageMembers, syncRecords } from '../config/schema';
import * as r2 from '../services/r2';
import { USER_QUOTA_BYTES } from '../usecases/fileUsecase';

vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) =>
    idToken === 'b' ? { sub: 'g-2', email: 'b@example.com' }
      : idToken === 'c' ? { sub: 'g-3', email: 'c@example.com' }
        : idToken === 'd' ? { sub: 'g-4', email: 'd@example.com' }
          : { sub: 'g-1', email: 'a@example.com' })
}));
vi.mock('../services/r2', () => ({
  objectKey: (scope: string, fileId: string) => `${scope[0]}/${scope.slice(2)}/${fileId}`,
  presignPut: vi.fn(async (key: string) => `https://r2.test/put/${key}`),
  presignGet: vi.fn(async (key: string) => `https://r2.test/get/${key}`),
  headObjectSize: vi.fn(),
  deleteObject: vi.fn(async () => undefined)
}));

useMyGarageDb();

const G = '0190a1b2-c3d4-7e5f-8a6b-1234567890a1';
const F = ['1', '2', '3'].map((n) => `0190a1b2-c3d4-7e5f-8a6b-12345678900${n}`);
const sign = async (idToken = 'a') => (await request(app).post('/api/mygarage/auth/google').send({ idToken })).body.data;
const call = (method: 'get' | 'post', path: string, token: string, body?: object) => {
  const r = request(app)[method](`/api/mygarage${path}`).set(authHeader(token));
  return body ? r.send(body) : r;
};
const setup = async () => {
  const a = await sign();
  const b = await sign('b');
  const c = await sign('c');
  const d = await sign('d');
  await call('post', `/v2/garages/${G}/share`, a.accessToken);
  await testDb.insert(garageMembers).values([
    { garageId: G, userId: b.user.id, role: 'editor' },
    { garageId: G, userId: c.user.id, role: 'viewer' }
  ]);
  return { a, b, c, d };
};
const uploaded = async (scope: string, ownerId: string, fileId: string, size = 10) =>
  testDb.insert(cloudFiles).values({ scope, ownerId, fileId, size, status: 'uploaded' });

beforeEach(() => {
  vi.mocked(r2.deleteObject).mockReset().mockResolvedValue(undefined);
});

describe('MyGarage scoped files', () => {
  it('an editor uploads to G and the object key is g/<G>/<file>', async () => {
    const { b } = await setup();
    const res = await call('post', `/v2/files/${G}/${F[0]}/upload-url`, b.accessToken, { size: 100 });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe(`https://r2.test/put/g/${G}/${F[0]}`);
    expect(r2.presignPut).toHaveBeenCalledWith(`g/${G}/${F[0]}`, expect.any(Number), 100);
    const personal = await call('post', `/v2/files/personal/${F[1]}/upload-url`, b.accessToken, { size: 5 });
    expect(personal.body.data.url).toContain(`/put/u/${b.user.id}/${F[1]}`);
  });

  it('a viewer cannot get an upload URL for G but can download', async () => {
    const { a, c } = await setup();
    await uploaded(`g:${G}`, a.user.id, F[0]);
    const up = await call('post', `/v2/files/${G}/${F[1]}/upload-url`, c.accessToken, { size: 1 });
    expect(up.status).toBe(403);
    expect((await call('post', `/v2/files/${G}/${F[0]}/complete`, c.accessToken)).status).toBe(403);
    const down = await call('get', `/v2/files/${G}/${F[0]}/download-url`, c.accessToken);
    expect(down.status).toBe(200);
    expect(down.body.data.url).toBe(`https://r2.test/get/g/${G}/${F[0]}`);
  });

  it('a non-member gets NO_ACCESS for every G file call, and a bad scope gets 400', async () => {
    const { d } = await setup();
    const t = d.accessToken;
    for (const res of [
      await call('post', `/v2/files/${G}/${F[0]}/upload-url`, t, { size: 1 }),
      await call('post', `/v2/files/${G}/${F[0]}/complete`, t),
      await call('get', `/v2/files/${G}/${F[0]}/download-url`, t)
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.message).toBe("You don't have access to this garage.");
    }
    const bad = await call('get', `/v2/files/nope/${F[0]}/download-url`, t);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Garage request was not valid.');
  });

  it("an editor's upload counts against the owner's quota", async () => {
    const { a, b } = await setup();
    await uploaded(`u:${a.user.id}`, a.user.id, F[2], USER_QUOTA_BYTES - 1);
    const ok = await call('post', `/v2/files/${G}/${F[0]}/upload-url`, b.accessToken, { size: 1 });
    expect(ok.status).toBe(200);
    const full = await call('post', `/v2/files/${G}/${F[1]}/upload-url`, b.accessToken, { size: 1 });
    expect(full.status).toBe(413);
    expect(full.body.message).toBe('Your cloud storage is full (1 GB). This file stays on your phone.');
    const row = await testDb.select().from(cloudFiles).where(and(eq(cloudFiles.scope, `g:${G}`), eq(cloudFiles.fileId, F[0])));
    expect(row[0].ownerId).toBe(a.user.id);
  });
});

describe('MyGarage release', () => {
  const rec = (scope: string, userId: string, id: string) =>
    ({ scope, writerId: userId, tbl: 'vehicles', id, updatedAt: 1, payload: 'x' });

  it('release deletes personal rows and files that exist in G and keeps the rest', async () => {
    const { a } = await setup();
    const u = `u:${a.user.id}`;
    await testDb.insert(syncRecords).values([
      rec(u, a.user.id, 'v1'), rec(u, a.user.id, 'v2'), rec(`g:${G}`, a.user.id, 'v1')
    ]);
    await uploaded(u, a.user.id, F[0]);
    await uploaded(u, a.user.id, F[1]);
    await uploaded(`g:${G}`, a.user.id, F[0]);
    const res = await call('post', `/v2/garages/${G}/release`, a.accessToken, {
      records: [{ tbl: 'vehicles', id: 'v1' }, { tbl: 'vehicles', id: 'v2' }],
      fileIds: [F[0], F[1]]
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ released: 2, kept: 2 });
    expect((await testDb.select().from(syncRecords).where(eq(syncRecords.scope, u))).map((r) => r.id)).toEqual(['v2']);
    expect((await testDb.select().from(cloudFiles).where(eq(cloudFiles.scope, u))).map((r) => r.fileId)).toEqual([F[1]]);
    expect(await testDb.select().from(syncRecords).where(eq(syncRecords.scope, `g:${G}`))).toHaveLength(1);
    expect(r2.deleteObject).toHaveBeenCalledTimes(1);
    expect(r2.deleteObject).toHaveBeenCalledWith(`u/${a.user.id}/${F[0]}`);
  });

  it('an R2 failure keeps the personal file row and counts it as kept', async () => {
    const { a } = await setup();
    const u = `u:${a.user.id}`;
    await uploaded(u, a.user.id, F[0]);
    await uploaded(`g:${G}`, a.user.id, F[0]);
    vi.mocked(r2.deleteObject).mockRejectedValueOnce(new Error('r2 down'));
    const res = await call('post', `/v2/garages/${G}/release`, a.accessToken, { records: [], fileIds: [F[0]] });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ released: 0, kept: 1 });
    expect(await testDb.select().from(cloudFiles).where(eq(cloudFiles.scope, u))).toHaveLength(1);
  });

  it("another user's personal rows and files with the same ids survive the owner's release", async () => {
    const { a, b } = await setup();
    const mine = `u:${a.user.id}`;
    const theirs = `u:${b.user.id}`;
    await testDb.insert(syncRecords).values([rec(mine, a.user.id, 'v1'), rec(theirs, b.user.id, 'v1'), rec(`g:${G}`, a.user.id, 'v1')]);
    await uploaded(mine, a.user.id, F[0]);
    await uploaded(theirs, b.user.id, F[0]);
    await uploaded(`g:${G}`, a.user.id, F[0]);
    const res = await call('post', `/v2/garages/${G}/release`, a.accessToken, { records: [{ tbl: 'vehicles', id: 'v1' }], fileIds: [F[0]] });
    expect(res.body.data).toEqual({ released: 2, kept: 0 });
    expect(await testDb.select().from(syncRecords).where(eq(syncRecords.scope, theirs))).toHaveLength(1);
    expect(await testDb.select().from(cloudFiles).where(eq(cloudFiles.scope, theirs))).toHaveLength(1);
    expect(await testDb.select().from(syncRecords).where(eq(syncRecords.scope, mine))).toHaveLength(0);
    expect(r2.deleteObject).toHaveBeenCalledTimes(1);
    expect(r2.deleteObject).toHaveBeenCalledWith(`u/${a.user.id}/${F[0]}`);
  });

  it('release is owner only and validates the body', async () => {
    const { a, b, d } = await setup();
    const body = { records: [], fileIds: [] };
    expect((await call('post', `/v2/garages/${G}/release`, b.accessToken, body)).status).toBe(403);
    expect((await call('post', `/v2/garages/${G}/release`, d.accessToken, body)).status).toBe(403);
    const bad = await call('post', `/v2/garages/${G}/release`, a.accessToken, { records: [], fileIds: ['x'] });
    expect(bad.status).toBe(400);
  });
});
