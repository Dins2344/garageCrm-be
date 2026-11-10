import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../../app';
import { authHeader } from '../../tests/helpers/factories';
import { testDb, useMyGarageDb } from './harness';
import { garageMembers, syncRecords } from '../config/schema';
import { roleIn } from '../usecases/garageUsecase';

vi.mock('../usecases/garageUsecase', async (orig) => {
  const m = await orig<typeof import('../usecases/garageUsecase')>();
  return { ...m, roleIn: vi.fn(m.roleIn) };
});
vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) =>
    idToken === 'b' ? { sub: 'g-2', email: 'b@example.com' }
      : idToken === 'c' ? { sub: 'g-3', email: 'c@example.com' }
        : idToken === 'd' ? { sub: 'g-4', email: 'd@example.com' }
          : { sub: 'g-1', email: 'a@example.com' })
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
const H = '0190a1b2-c3d4-7e5f-8a6b-1234567890a2';
const FILE = '0190a1b2-c3d4-7e5f-8a6b-123456789001';
const sign = async (idToken = 'a') => (await request(app).post('/api/mygarage/auth/google').send({ idToken })).body.data;
/** a owns G, b is an editor, c a viewer, d is outside. */
const setup = async () => {
  const [a, b, c, d] = [await sign(), await sign('b'), await sign('c'), await sign('d')];
  await request(app).post(`/api/mygarage/v2/garages/${G}/share`).set(authHeader(a.accessToken));
  await testDb.insert(garageMembers).values([
    { garageId: G, userId: b.user.id, role: 'editor' },
    { garageId: G, userId: c.user.id, role: 'viewer' }
  ]);
  return { a, b, c, d };
};
const ch = (scope: string, id: string, updatedAt = 10, extra: Record<string, unknown> = {}) =>
  ({ scope, tbl: 'vehicles', id, updatedAt, deletedAt: null, payload: 'QUJD', ...extra });
const push = (token: string, changes: unknown[]) =>
  request(app).post('/api/mygarage/v2/sync/push').set(authHeader(token)).send({ changes });
const pull = (token: string, cursors: Record<string, number> = {}, limit?: number) =>
  request(app).post('/api/mygarage/v2/sync/pull').set(authHeader(token)).send({ cursors, limit });
const stored = async () => testDb.select().from(syncRecords);
const ids = (res: { body: { data: { changes: { id: string }[] } } }) => res.body.data.changes.map((c) => c.id);

describe('MyGarage scoped sync', () => {
  it('a push that passed its role check but lost access before the scope lock is rejected and stores nothing', async () => {
    const { d } = await setup();
    // First roleIn call is the pre-check: pretend d was still an editor. The in-lock check sees the truth (no membership).
    vi.mocked(roleIn).mockImplementationOnce(async () => 'editor');
    const res = await push(d.accessToken, [ch(G, 'v1')]);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ accepted: 0, skipped: 0, rejected: [{ scope: G, tbl: 'vehicles', id: 'v1' }] });
    expect((await stored()).filter((r) => r.scope === `g:${G}`)).toEqual([]);
  });

  it('owner and editor push to G; every member pulls them with scope G', async () => {
    const { a, b, c } = await setup();
    expect((await push(a.accessToken, [ch(G, 'v1')])).body.data).toEqual({ accepted: 1, skipped: 0, rejected: [] });
    expect((await push(b.accessToken, [ch(G, 'v2')])).body.data.accepted).toBe(1);
    for (const t of [a, b, c]) {
      const res = await pull(t.accessToken);
      expect(res.status).toBe(200);
      expect(res.body.data.changes.map((x: { id: string; scope: string }) => [x.id, x.scope])).toEqual([['v1', G], ['v2', G]]);
    }
  });

  it('a viewer push to G is rejected and nothing is stored', async () => {
    const { c } = await setup();
    const res = await push(c.accessToken, [ch(G, 'v1')]);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ accepted: 0, skipped: 0, rejected: [{ scope: G, tbl: 'vehicles', id: 'v1' }] });
    expect(await stored()).toHaveLength(0);
  });

  it('an editor change to the garages row of G is rejected; the owner one is accepted', async () => {
    const { a, b } = await setup();
    const row = (updatedAt: number, deletedAt: number | null) => ({ ...ch(G, G, updatedAt, { deletedAt }), tbl: 'garages' });
    const bad = await push(b.accessToken, [row(10, null), row(11, 11)]);
    expect(bad.body.data.accepted).toBe(0);
    expect(bad.body.data.rejected).toHaveLength(2);
    expect(await stored()).toHaveLength(0);
    expect((await push(a.accessToken, [row(10, null)])).body.data.accepted).toBe(1);
    expect((await push(b.accessToken, [row(12, 12)])).body.data.rejected).toHaveLength(1);
    expect((await stored())[0]).toMatchObject({ id: G, updatedAt: 10, deletedAt: null });
  });

  it('a garages row with another id inside scope G is rejected', async () => {
    const { a } = await setup();
    const res = await push(a.accessToken, [{ ...ch(G, H), tbl: 'garages' }, ch(G, 'v1')]);
    expect(res.body.data).toEqual({ accepted: 1, skipped: 0, rejected: [{ scope: G, tbl: 'garages', id: H }] });
    expect((await stored()).map((r) => r.id)).toEqual(['v1']);
  });

  it('pushing to a garage the caller is not in is rejected', async () => {
    const { d } = await setup();
    const res = await push(d.accessToken, [ch(G, 'v1'), ch(H, 'v2'), ch('personal', 'mine')]);
    expect(res.body.data.accepted).toBe(1);
    expect(res.body.data.rejected).toHaveLength(2);
    expect((await stored()).map((r) => r.scope)).toEqual([expect.stringMatching(/^u:/)]);
  });

  it('pull starts a new scope at 0 and returns its cursor', async () => {
    const { a, b } = await setup();
    await push(a.accessToken, [ch(G, 'v1')]);
    await push(b.accessToken, [ch('personal', 'p1')]);
    const res = await pull(b.accessToken, { personal: 0 });
    expect(ids(res)).toEqual(['v1', 'p1']);
    const [g, p] = res.body.data.changes;
    expect(res.body.data.cursors).toEqual({ personal: p.seq, [G]: g.seq });
    expect((await pull(b.accessToken, res.body.data.cursors)).body.data.changes).toEqual([]);
  });

  it('pull drops a cursor for a garage the caller was removed from and returns none of its rows', async () => {
    const { a, b } = await setup();
    await push(a.accessToken, [ch(G, 'v1')]);
    await testDb.delete(garageMembers).where(eq(garageMembers.userId, b.user.id));
    const res = await pull(b.accessToken, { [G]: 0, personal: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.changes).toEqual([]);
    expect(res.body.data.cursors).toEqual({ personal: 0 });
  });

  it('pull pages across scopes in seq order with limit and more', async () => {
    const { a } = await setup();
    await push(a.accessToken, [ch(G, 'v1'), ch('personal', 'p1')]);
    await push(a.accessToken, [ch(G, 'v2'), ch('personal', 'p2')]);
    const first = await pull(a.accessToken, {}, 3);
    expect(ids(first)).toEqual(['v1', 'p1', 'v2']);
    expect(first.body.data.more).toBe(true);
    const second = await pull(a.accessToken, first.body.data.cursors, 3);
    expect(ids(second)).toEqual(['p2']);
    expect(second.body.data.more).toBe(false);
  });

  it('personal rows of one user never reach another member', async () => {
    const { a, b } = await setup();
    await push(a.accessToken, [ch('personal', 'secret')]);
    expect(ids(await pull(b.accessToken))).toEqual([]);
    expect(ids(await pull(a.accessToken))).toEqual(['secret']);
  });

  it('rejects bad pull bodies', async () => {
    const { a } = await setup();
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`0190a1b2-c3d4-7e5f-8a6b-${String(i).padStart(12, '0')}`, 0]));
    for (const cursors of [{ nope: 0 }, { personal: -1 }, { personal: 1.5 }, many]) {
      const res = await pull(a.accessToken, cursors);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Sync data was not in the expected format.');
    }
  });

  it('old /sync/pull and /sync/push answer 426 once the user is in a garage, and work as before otherwise', async () => {
    const { b, d } = await setup();
    const legacyPush = (t: string) => request(app).post('/api/mygarage/sync/push').set(authHeader(t)).send({ changes: [] });
    const legacyPull = (t: string) => request(app).get('/api/mygarage/sync/pull').set(authHeader(t));
    for (const res of [await legacyPush(b.accessToken), await legacyPull(b.accessToken)]) {
      expect(res.status).toBe(426);
      expect(res.body).toEqual({ success: false, message: 'Update MyGarage to keep syncing.' });
    }
    expect((await legacyPush(d.accessToken)).body).toEqual({ success: true, data: { accepted: 0, skipped: 0 } });
    expect((await legacyPull(d.accessToken)).status).toBe(200);
  });

  it('old /files/:fileId/upload-url answers 426 for a member', async () => {
    const { b } = await setup();
    const res = await request(app).post(`/api/mygarage/files/${FILE}/upload-url`).set(authHeader(b.accessToken)).send({ size: 10 });
    expect(res.status).toBe(426);
    expect(res.body.message).toBe('Update MyGarage to keep syncing.');
  });
});
