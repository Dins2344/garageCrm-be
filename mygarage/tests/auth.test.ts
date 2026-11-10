import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import app from '../../app';
import logger from '../../utils/logger';
import { HttpError } from '../../utils/httpError';
import { createGarageWithOwner, authHeader } from '../../tests/helpers/factories';
import { mgDb } from '../config/db';
import { users } from '../config/schema';
import { useMyGarageDb, TEST_ENV } from './harness';
import { wrapKey, unwrapKey, newDataKey } from '../services/crypto';

vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) => {
    if (idToken === 'bad') throw new HttpError('Google sign-in failed. Try again.', 401);
    if (idToken === 'other') return { sub: 'g-2', email: 'b@example.com', name: null };
    if (idToken === 'named') return { sub: 'g-3', email: 'c@example.com', name: 'Dinson' };
    if (idToken === 'renamed') return { sub: 'g-3', email: 'c@example.com', name: 'Dinson D' };
    return { sub: 'g-1', email: 'a@example.com', name: null };
  })
}));

useMyGarageDb();

const signIn = async (idToken = 'good') => {
  const res = await request(app).post('/api/mygarage/auth/google').send({ idToken });
  // Success bodies are { success: true, data }; tests read the session from res.body.
  if (res.status === 200) {
    expect(res.body.success).toBe(true);
    res.body = res.body.data;
  }
  return res;
};
const ENDED = 'Your session has ended. Sign in again.';

describe('MyGarage auth', () => {
  it('first sign-in creates one user and returns a session', async () => {
    const res = await signIn();
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.id).toBeTruthy();
    expect(await mgDb.select().from(users)).toHaveLength(1);
  });

  it('second sign-in with the same Google account reuses the user', async () => {
    const a = await signIn();
    const b = await signIn();
    expect(b.body.user.id).toBe(a.body.user.id);
    expect(await mgDb.select().from(users)).toHaveLength(1);
  });

  it('sign-in stores and updates the Google name', async () => {
    await signIn('named');
    expect((await mgDb.select().from(users).where(eq(users.googleSub, 'g-3')))[0].name).toBe('Dinson');
    await signIn('renamed');
    expect((await mgDb.select().from(users).where(eq(users.googleSub, 'g-3')))[0].name).toBe('Dinson D');
  });

  it('rejects a bad Google token', async () => {
    const res = await signIn('bad');
    expect(res.status).toBe(401);
    expect(res.body.message).toBe('Google sign-in failed. Try again.');
  });

  it('rejects a malformed body', async () => {
    for (const path of ['google', 'refresh', 'sign-out']) {
      const res = await request(app).post(`/api/mygarage/auth/${path}`).send({ idToken: 5, refreshToken: {} });
      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Sign-in request was not valid.');
    }
  });

  it('GET /me works with the access token and rejects none or garbage', async () => {
    const { body } = await signIn();
    const ok = await request(app).get('/api/mygarage/me').set(authHeader(body.accessToken));
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true, data: { id: body.user.id, email: 'a@example.com' } });
    for (const headers of [{}, authHeader('garbage')]) {
      const res = await request(app).get('/api/mygarage/me').set(headers);
      expect(res.status).toBe(401);
      expect(res.body.message).toBe(ENDED);
    }
  });

  it('rejects a token of the wrong type, or for a missing user', async () => {
    const { body } = await signIn();
    const wrongType = jwt.sign({ typ: 'x' }, TEST_ENV.jwtSecret, { subject: body.user.id, algorithm: 'HS256' });
    const noUser = jwt.sign({ typ: 'mg-access' }, TEST_ENV.jwtSecret, { subject: 'nobody', algorithm: 'HS256' });
    for (const t of [wrongType, noUser]) {
      expect((await request(app).get('/api/mygarage/me').set(authHeader(t))).status).toBe(401);
    }
  });

  it('a GaragePulse token is rejected here', async () => {
    const { token } = await createGarageWithOwner('mg1');
    const res = await request(app).get('/api/mygarage/me').set(authHeader(token));
    expect(res.status).toBe(401);
  });

  it('a MyGarage token is rejected by GaragePulse', async () => {
    const { body } = await signIn();
    const res = await request(app).get('/api/auth/me').set(authHeader(body.accessToken));
    expect(res.status).toBe(401);
  });

  it('refresh rotates', async () => {
    const first = (await signIn()).body;
    const res = await request(app).post('/api/mygarage/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    res.body = res.body.data;
    expect(res.body.refreshToken).not.toBe(first.refreshToken);
    expect(res.body.user.id).toBe(first.user.id);
    const old = await request(app).post('/api/mygarage/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(old.status).toBe(401);
    expect(old.body.message).toBe(ENDED);
    const next = await request(app).post('/api/mygarage/auth/refresh').send({ refreshToken: res.body.refreshToken });
    expect(next.status).toBe(200);
  });

  it('sign-out revokes', async () => {
    const { refreshToken } = (await signIn()).body;
    const out = await request(app).post('/api/mygarage/auth/sign-out').send({ refreshToken });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: true });
    expect((await request(app).post('/api/mygarage/auth/refresh').send({ refreshToken })).status).toBe(401);
    expect((await request(app).post('/api/mygarage/auth/sign-out').send({ refreshToken: 'unknown' })).status).toBe(200);
  });

  it('GET /key is stable per user and different between users', async () => {
    const a = (await signIn()).body;
    const b = (await signIn('other')).body;
    const key = async (t: string) => (await request(app).get('/api/mygarage/key').set(authHeader(t))).body.data.key as string;
    const k1 = await key(a.accessToken);
    expect(Buffer.from(k1, 'base64')).toHaveLength(32);
    expect(await key(a.accessToken)).toBe(k1);
    expect(await key(b.accessToken)).not.toBe(k1);
    const rows = await mgDb.select().from(users);
    expect(rows.every(r => !r.wrappedKey.includes(k1))).toBe(true);
  });

  it('wrapKey and unwrapKey round-trip, and tampering throws', () => {
    const key = newDataKey();
    const wrapped = wrapKey(key, TEST_ENV.masterKey);
    expect(unwrapKey(wrapped, TEST_ENV.masterKey).equals(key)).toBe(true);
    const raw = Buffer.from(wrapped, 'base64');
    raw[20] ^= 1;
    expect(() => unwrapKey(raw.toString('base64'), TEST_ENV.masterKey)).toThrow();
  });
});

describe('MyGarage limits', () => {
  it('the auth limiter stops the 31st sign-in from one IP', async () => {
    let last = await signIn();
    for (let i = 0; i < 30; i++) last = await signIn();
    expect(last.status).toBe(429);
    expect(last.body).toEqual({ success: false, message: 'Too many attempts. Try again in a few minutes.' });
  });

  it('refresh is not stopped by the sign-in limit', async () => {
    const hit = () => request(app).post('/api/mygarage/auth/refresh').send({ refreshToken: 'nope' });
    let last = await hit();
    for (let i = 0; i < 30; i++) last = await hit();
    expect(last.status).toBe(401);
  });

  it('counts by the rightmost X-Forwarded-For entry, not a client-supplied one', async () => {
    const hit = (xff: string) => request(app).post('/api/mygarage/auth/google').set('X-Forwarded-For', xff).send({ idToken: 'bad' });
    for (let i = 0; i < 30; i++) await hit(`10.0.0.${i}, 5.5.5.5`);
    expect((await hit('10.0.1.1, 5.5.5.5')).status).toBe(429);
    expect((await hit('10.0.0.0, 6.6.6.6')).status).toBe(401);
  });

  it('user routes use their own limit', async () => {
    const { accessToken } = (await signIn()).body;
    const res = await request(app).get('/api/mygarage/me').set(authHeader(accessToken));
    expect(res.headers['ratelimit-policy']).toBe('600;w=600');
    expect(Object.values(res.headers)).not.toContain('1000');
  });
});

describe('MyGarage logging', () => {
  it('nothing personal is logged', async () => {
    const spy = vi.spyOn(logger, 'write');
    const s = (await signIn('secret-id-token')).body;
    const r = (await request(app).post('/api/mygarage/auth/refresh').send({ refreshToken: s.refreshToken })).body.data;
    const k = (await request(app).get('/api/mygarage/key').set(authHeader(r.accessToken))).body.data.key as string;
    await signIn('bad');
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(logged.length).toBeGreaterThan(2);
    for (const secret of ['a@example.com', 'secret-id-token', s.accessToken, s.refreshToken, r.accessToken, r.refreshToken, k]) {
      expect(logged).not.toContain(secret);
    }
  });
});
