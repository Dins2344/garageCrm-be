import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import app from '../../app';
import logger from '../../utils/logger';
import { authHeader } from '../../tests/helpers/factories';
import { useMyGarageDb } from './harness';

vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) =>
    idToken === 'other' ? { sub: 'g-2', email: 'b@example.com' } : { sub: 'g-1', email: 'a@example.com' })
}));

useMyGarageDb();

const BAD = 'Sync data was not in the expected format.';
const tokenFor = async (idToken = 'good'): Promise<string> =>
  (await request(app).post('/api/mygarage/auth/google').send({ idToken })).body.data.accessToken;

const change = (id: string, updatedAt: number, extra: Record<string, unknown> = {}) =>
  ({ tbl: 'vehicles', id, updatedAt, deletedAt: null, payload: 'QUJD', ...extra });
const push = (token: string, changes: unknown[]) =>
  request(app).post('/api/mygarage/sync/push').set(authHeader(token)).send({ changes });
const pull = (token: string, query = '') =>
  request(app).get(`/api/mygarage/sync/pull${query}`).set(authHeader(token));

describe('MyGarage sync', () => {
  it('push then pull returns the rows with increasing seq', async () => {
    const t = await tokenFor();
    const res = await push(t, [change('a', 10), change('b', 10)]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { accepted: 2, skipped: 0 } });
    const got = await pull(t);
    expect(got.body.success).toBe(true);
    const { changes, more } = got.body.data;
    expect(changes.map((c: { id: string }) => c.id)).toEqual(['a', 'b']);
    expect(changes[0].seq).toBeLessThan(changes[1].seq);
    expect(changes[0]).toMatchObject({ tbl: 'vehicles', updatedAt: 10, deletedAt: null, payload: 'QUJD' });
    expect(more).toBe(false);
  });

  it('an older or equal updatedAt is skipped and keeps the stored payload', async () => {
    const t = await tokenFor();
    await push(t, [change('a', 10)]);
    for (const at of [10, 5]) {
      const res = await push(t, [change('a', at, { payload: 'WFla' })]);
      expect(res.body.data).toEqual({ accepted: 0, skipped: 1 });
    }
    expect((await pull(t)).body.data.changes[0].payload).toBe('QUJD');
  });

  it('a newer updatedAt replaces the row and gets a higher seq than every earlier row', async () => {
    const t = await tokenFor();
    await push(t, [change('a', 10), change('b', 10)]);
    await push(t, [change('a', 11, { payload: 'WFla' })]);
    const { changes } = (await pull(t)).body.data;
    expect(changes).toHaveLength(2);
    const a = changes.find((c: { id: string }) => c.id === 'a');
    const b = changes.find((c: { id: string }) => c.id === 'b');
    expect(a.payload).toBe('WFla');
    expect(a.seq).toBeGreaterThan(b.seq);
  });

  it('deletedAt syncs like an edit', async () => {
    const t = await tokenFor();
    await push(t, [change('a', 10)]);
    const res = await push(t, [change('a', 11, { deletedAt: 11 })]);
    expect(res.body.data.accepted).toBe(1);
    expect((await pull(t)).body.data.changes[0]).toMatchObject({ updatedAt: 11, deletedAt: 11 });
  });

  it('users are isolated', async () => {
    const a = await tokenFor();
    const b = await tokenFor('other');
    await push(a, [change('a', 10)]);
    expect((await pull(b)).body.data.changes).toEqual([]);
    const res = await push(b, [change('a', 5, { payload: 'WFla' })]);
    expect(res.body.data.accepted).toBe(1);
    const mine = (await pull(a)).body.data.changes;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ updatedAt: 10, payload: 'QUJD' });
  });

  it('rejects bad input with 400', async () => {
    const t = await tokenFor();
    const cases = [
      [change('a', 1, { tbl: 'Vehicles' })],
      [change('a', 1, { tbl: 'a;drop' })],
      [change('', 1)],
      Array.from({ length: 201 }, (_, i) => change(`r${i}`, 1)),
      [change('a', 1, { payload: 'A'.repeat(65537) })],
      [change('a', -1)]
    ];
    for (const changes of cases) {
      const res = await push(t, changes);
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ success: false, message: BAD });
    }
    expect((await pull(t)).body.data.changes).toEqual([]);
  });

  it('rejects a bad since', async () => {
    const t = await tokenFor();
    for (const q of ['?since=abc', '?since=-1']) {
      const res = await pull(t, q);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(BAD);
    }
  });

  it('requires a session', async () => {
    expect((await request(app).get('/api/mygarage/sync/pull')).status).toBe(401);
    expect((await request(app).post('/api/mygarage/sync/push').send({ changes: [] })).status).toBe(401);
  });

  it('pull pages', async () => {
    const t = await tokenFor();
    await push(t, ['a', 'b', 'c', 'd', 'e'].map(id => change(id, 1)));
    const seen: string[] = [];
    let since = 0;
    let more = true;
    let pages = 0;
    while (more) {
      const { data } = (await pull(t, `?since=${since}&limit=2`)).body;
      seen.push(...data.changes.map((c: { id: string }) => c.id));
      since = data.next;
      more = data.more;
      pages += 1;
      expect(pages).toBeLessThan(10);
    }
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(pages).toBe(3);
    const end = (await pull(t, `?since=${since}`)).body.data;
    expect(end).toEqual({ changes: [], next: since, more: false });
  });

  it('pull past the end', async () => {
    const t = await tokenFor();
    await push(t, [change('a', 1)]);
    const { data } = (await pull(t, '?since=999999999')).body;
    expect(data).toEqual({ changes: [], next: 999999999, more: false });
  });

  it('a body over 1 MB returns a JSON 413', async () => {
    const t = await tokenFor();
    const res = await request(app).post('/api/mygarage/sync/push').set(authHeader(t))
      .send({ changes: [change('a', 1, { payload: 'A'.repeat(1_100_000) })] });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ success: false, message: 'Too much data in one request.' });
  });

  it('nothing personal is logged', async () => {
    const t = await tokenFor();
    const spy = vi.spyOn(logger, 'write');
    const secret = 'U0VDUkVUUEFZTE9BRA==';
    await push(t, [change('a', 1, { payload: secret })]);
    await push(t, [change('a', 1, { payload: secret })]);
    await pull(t);
    await push(t, [change('a', 1, { tbl: 'Bad', payload: secret })]);
    expect(JSON.stringify(spy.mock.calls)).not.toContain(secret);
    spy.mockRestore();
  });
});
