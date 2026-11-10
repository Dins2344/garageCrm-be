import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import app from '../../app';
import { authHeader } from '../../tests/helpers/factories';
import { testDb, useMyGarageDb } from './harness';
import { cloudFiles, garageMembers, sharedGarages, syncRecords, users } from '../config/schema';
import * as r2 from '../services/r2';
import { ownerOf } from '../usecases/fileUsecase';

vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) =>
    idToken === 'b' ? { sub: 'g-2', email: 'b@example.com' }
      : idToken === 'c' ? { sub: 'g-3', email: 'c@example.com', name: 'Cara' }
        : { sub: 'g-1', email: 'a@example.com', name: 'Dinson' })
}));
vi.mock('../services/r2', () => ({
  objectKey: (scope: string, fileId: string) => `${scope[0]}/${scope.slice(2)}/${fileId}`,
  presignPut: vi.fn(),
  presignGet: vi.fn(),
  headObjectSize: vi.fn(),
  deleteObject: vi.fn(async () => undefined)
}));

useMyGarageDb();

const G = '0190a1b2-c3d4-7e5f-8a6b-1234567890a1';
const F = ['1', '2'].map((n) => `0190a1b2-c3d4-7e5f-8a6b-12345678900${n}`);
const sign = async (idToken = 'a') => (await request(app).post('/api/mygarage/auth/google').send({ idToken })).body.data;
const api = (method: 'get' | 'post' | 'patch' | 'delete', path: string, token: string) =>
  request(app)[method](`/api/mygarage/v2/garages${path}`).set(authHeader(token));
/** Owner a shares G; b and c join as the given roles straight in the table. */
const setup = async () => {
  const a = await sign();
  const b = await sign('b');
  const c = await sign('c');
  await api('post', `/${G}/share`, a.accessToken);
  await testDb.insert(garageMembers).values([
    { garageId: G, userId: b.user.id, role: 'editor' },
    { garageId: G, userId: c.user.id, role: 'viewer' }
  ]);
  return { a, b, c };
};
const members = async () => testDb.select().from(garageMembers).where(eq(garageMembers.garageId, G));

beforeEach(() => {
  vi.mocked(r2.deleteObject).mockReset().mockResolvedValue(undefined);
});

describe('MyGarage shared garages', () => {
  it('share creates the garage, its key and the owner membership, and is idempotent', async () => {
    const a = await sign();
    const first = await api('post', `/${G}/share`, a.accessToken);
    expect(first.status).toBe(200);
    expect(Buffer.from(first.body.data.key, 'base64')).toHaveLength(32);
    const second = await api('post', `/${G}/share`, a.accessToken);
    expect(second.body.data.key).toBe(first.body.data.key);
    expect(await members()).toMatchObject([{ userId: a.user.id, role: 'owner' }]);
    expect(await testDb.select().from(sharedGarages)).toHaveLength(1);
  });

  it('rejects a bad garage id and a bad role', async () => {
    const { a, b } = await setup();
    const bad = await api('post', '/not-a-uuid/share', a.accessToken);
    expect(bad.status).toBe(400);
    expect(bad.body.message).toBe('Garage request was not valid.');
    const role = await api('patch', `/${G}/members/${b.user.id}`, a.accessToken).send({ role: 'owner' });
    expect(role.status).toBe(400);
  });

  it('a second account sharing the same garage id gets 409 TAKEN', async () => {
    const a = await sign();
    const b = await sign('b');
    await api('post', `/${G}/share`, a.accessToken);
    const res = await api('post', `/${G}/share`, b.accessToken);
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('This garage is already shared by someone else.');
    expect(await members()).toHaveLength(1);
  });

  it('GET /v2/garages lists owned and joined garages with role and owner name', async () => {
    const { a, b } = await setup();
    const own = (await api('get', '', a.accessToken)).body.data.garages;
    expect(own).toEqual([{ garageId: G, role: 'owner', ownerName: 'Dinson' }]);
    expect((await api('get', '', b.accessToken)).body.data.garages).toEqual([{ garageId: G, role: 'editor', ownerName: 'Dinson' }]);
    await testDb.update(users).set({ name: null }).where(eq(users.id, a.user.id));
    expect((await api('get', '', b.accessToken)).body.data.garages[0].ownerName).toBe('a@example.com');
  });

  it('key is returned to members and refused with NO_ACCESS to others', async () => {
    const { a, b } = await setup();
    const owner = await api('get', `/${G}/key`, a.accessToken);
    expect((await api('get', `/${G}/key`, b.accessToken)).body.data.key).toBe(owner.body.data.key);
    const out = await sign('b');
    await testDb.delete(garageMembers).where(eq(garageMembers.userId, out.user.id));
    for (const id of [G, '0190a1b2-c3d4-7e5f-8a6b-1234567890ff']) {
      const res = await api('get', `/${id}/key`, out.accessToken);
      expect(res.status).toBe(403);
      expect(res.body.message).toBe("You don't have access to this garage.");
    }
  });

  it('people is owner only and lists members with roles', async () => {
    const { a, b } = await setup();
    const res = await api('get', `/${G}/people`, a.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data.invites).toEqual([]);
    expect(res.body.data.members.map((m: { email: string; role: string }) => [m.email, m.role]).sort())
      .toEqual([['a@example.com', 'owner'], ['b@example.com', 'editor'], ['c@example.com', 'viewer']]);
    const denied = await api('get', `/${G}/people`, b.accessToken);
    expect(denied.status).toBe(403);
    expect(denied.body.message).toBe('Only the garage owner can do this.');
  });

  it('setRole changes a member and never the owner', async () => {
    const { a, b, c } = await setup();
    expect((await api('patch', `/${G}/members/${b.user.id}`, a.accessToken).send({ role: 'viewer' })).status).toBe(200);
    expect((await members()).find((m) => m.userId === b.user.id)?.role).toBe('viewer');
    expect((await api('patch', `/${G}/members/${a.user.id}`, a.accessToken).send({ role: 'viewer' })).status).toBe(403);
    expect((await members()).find((m) => m.userId === a.user.id)?.role).toBe('owner');
    expect((await api('patch', `/${G}/members/${c.user.id}`, b.accessToken).send({ role: 'editor' })).status).toBe(403);
    expect((await api('patch', `/${G}/members/nobody`, a.accessToken).send({ role: 'editor' })).status).toBe(404);
  });

  it('a member leaves; the owner removes a member; the owner cannot be removed; a member cannot remove another', async () => {
    const { a, b, c } = await setup();
    expect((await api('delete', `/${G}/members/${a.user.id}`, b.accessToken)).status).toBe(403);
    expect((await api('delete', `/${G}/members/${c.user.id}`, b.accessToken)).status).toBe(403);
    expect((await api('delete', `/${G}/members/${a.user.id}`, a.accessToken)).status).toBe(403);
    expect((await api('delete', `/${G}/members/${b.user.id}`, b.accessToken)).status).toBe(200);
    expect((await api('delete', `/${G}/members/${c.user.id}`, a.accessToken)).status).toBe(200);
    expect(await members()).toMatchObject([{ userId: a.user.id, role: 'owner' }]);
  });

  const seedScope = async (ownerId: string, writerId: string) => {
    await testDb.insert(cloudFiles).values(F.map((fileId) => ({ scope: `g:${G}`, ownerId, fileId, size: 10, status: 'uploaded' as const })));
    await testDb.insert(syncRecords).values({ scope: `g:${G}`, writerId, tbl: 'vehicles', id: 'v1', updatedAt: 1, payload: 'x' });
  };

  it("deleteGarage is owner only, deletes the scope's rows, files and R2 objects, and members lose the garage", async () => {
    const { a, b } = await setup();
    await seedScope(a.user.id, b.user.id);
    const denied = await api('delete', `/${G}`, b.accessToken);
    expect(denied.status).toBe(403);
    expect(await testDb.select().from(cloudFiles)).toHaveLength(2);
    expect((await api('delete', `/${G}`, a.accessToken)).status).toBe(200);
    expect(vi.mocked(r2.deleteObject).mock.calls.map((x) => x[0]).sort()).toEqual(F.map((f) => `g/${G}/${f}`).sort());
    expect(await testDb.select().from(cloudFiles)).toHaveLength(0);
    expect(await testDb.select().from(syncRecords)).toHaveLength(0);
    expect(await testDb.select().from(sharedGarages)).toHaveLength(0);
    expect(await members()).toHaveLength(0);
    expect((await api('get', '', b.accessToken)).body.data.garages).toEqual([]);
    expect((await api('get', `/${G}/key`, b.accessToken)).status).toBe(403);
  });

  it('after deleteGarage no sync row of the scope remains and the former owner pulls none', async () => {
    const { a, b } = await setup();
    await seedScope(a.user.id, b.user.id);
    expect((await api('delete', `/${G}`, a.accessToken)).status).toBe(200);
    expect(await testDb.select().from(syncRecords).where(eq(syncRecords.scope, `g:${G}`))).toHaveLength(0);
    const pull = await request(app).post('/api/mygarage/v2/sync/pull').set(authHeader(a.accessToken)).send({ cursors: { [G]: 0 } });
    expect(pull.status).toBe(200);
    expect(pull.body.data.changes).toEqual([]);
  });

  it('deleteGarage keeps everything and answers 502 when an R2 delete fails', async () => {
    const { a, b } = await setup();
    await seedScope(a.user.id, b.user.id);
    vi.mocked(r2.deleteObject).mockResolvedValueOnce(undefined).mockRejectedValue(new Error('boom'));
    const res = await api('delete', `/${G}`, a.accessToken);
    expect(res.status).toBe(502);
    expect(res.body.message).toBe('Could not delete the garage files. Try again.');
    expect(await testDb.select().from(sharedGarages)).toHaveLength(1);
    expect(await testDb.select().from(syncRecords)).toHaveLength(1);
    expect(await testDb.select().from(cloudFiles)).toHaveLength(1);
    expect(await members()).toHaveLength(3);
  });

  it('account deletion of an owner deletes their shared garages and their members\' access', async () => {
    const { a, b } = await setup();
    await seedScope(a.user.id, b.user.id);
    expect((await request(app).delete('/api/mygarage/account').set(authHeader(a.accessToken))).status).toBe(200);
    expect(await testDb.select().from(sharedGarages)).toHaveLength(0);
    expect(await members()).toHaveLength(0);
    expect(await testDb.select().from(syncRecords)).toHaveLength(0);
    expect(vi.mocked(r2.deleteObject)).toHaveBeenCalledTimes(2);
    expect((await api('get', '', b.accessToken)).body.data.garages).toEqual([]);
  });

  it('account deletion of a member keeps the garage rows they wrote, with writerId null', async () => {
    const { a, b } = await setup();
    await seedScope(a.user.id, b.user.id);
    expect((await request(app).delete('/api/mygarage/account').set(authHeader(b.accessToken))).status).toBe(200);
    const [row] = await testDb.select().from(syncRecords).where(and(eq(syncRecords.scope, `g:${G}`), eq(syncRecords.id, 'v1')));
    expect(row.writerId).toBeNull();
    expect(await testDb.select().from(sharedGarages)).toHaveLength(1);
    expect(await members()).toHaveLength(2);
  });

  it('ownerOf resolves a garage scope to its owner, and an unknown garage to 404', async () => {
    const { a, b } = await setup();
    expect(await ownerOf(`g:${G}`, b.user.id)).toBe(a.user.id);
    expect(await ownerOf(`u:${b.user.id}`, b.user.id)).toBe(b.user.id);
    await expect(ownerOf('g:0190a1b2-c3d4-7e5f-8a6b-1234567890ff', b.user.id)).rejects.toMatchObject({ statusCode: 404 });
  });
});
