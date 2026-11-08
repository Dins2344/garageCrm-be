import { describe, it, expect, vi, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app';
import logger from '../../utils/logger';
import { authHeader } from '../../tests/helpers/factories';
import { setMgDb, MgDb } from '../config/db';
import { useMyGarageDb, testDb } from './harness';

vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async () => ({ sub: 'g-1', email: 'private.person@example.com' }))
}));

useMyGarageDb();

const UNAVAILABLE = 'Sync is unavailable right now. Try again later.';
const SQL_TEXT = 'Failed query: insert into "users" params: private.person@example.com';

/** Makes one table method throw a Drizzle-style error whose message carries the SQL and its parameters. */
const breakDb = (method: 'insert' | 'select'): (() => void) => {
  setMgDb(new Proxy(testDb, {
    get(target, prop) {
      if (prop === method) throw new Error(SQL_TEXT);
      return (target as unknown as Record<string | symbol, unknown>)[prop];
    }
  }) as unknown as MgDb);
  return () => setMgDb(testDb);
};

let restore: (() => void) | null = null;
afterEach(() => { restore?.(); restore = null; });

describe('MyGarage error handling', () => {
  it('a database failure during sign-in is a 503 and logs no personal data', async () => {
    const spy = vi.spyOn(logger, 'write');
    restore = breakDb('insert');
    const res = await request(app).post('/api/mygarage/auth/google').send({ idToken: 'the-id-token' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: UNAVAILABLE });
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    for (const secret of ['private.person@example.com', 'the-id-token', 'Failed query']) {
      expect(logged).not.toContain(secret);
    }
  });

  it('a database failure while checking the access token is a 503, not a 401', async () => {
    const si = await request(app).post('/api/mygarage/auth/google').send({ idToken: 'x' });
    const t = si.body.data.accessToken;
    restore = breakDb('select');
    const res = await request(app).get('/api/mygarage/me').set(authHeader(t));
    expect(res.status).toBe(503);
    expect(res.body.message).toBe(UNAVAILABLE);
  });

  it('a malformed JSON body gets a plain 400 and is never logged', async () => {
    const spy = vi.spyOn(logger, 'write');
    const res = await request(app).post('/api/mygarage/auth/google')
      .set('Content-Type', 'application/json').send('{"idToken": "leaky-body-text",');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, message: 'Sync data was not in the expected format.' });
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged).not.toContain('leaky-body-text');
  });

  it('a GaragePulse route keeps its own handler for malformed JSON', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Content-Type', 'application/json').send('{"email": ');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).not.toBe('Sync data was not in the expected format.');
    expect(res.body.message).toMatch(/JSON/);
  });
});
