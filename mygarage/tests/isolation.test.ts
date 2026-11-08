import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { EventEmitter } from 'events';
import app from '../../app';
import { loadMyGarageEnv, setMyGarageEnv } from '../config/env';
import { setMgDb, connectMyGarage } from '../config/db';

const FULL = {
  JWT_SECRET: 'garagepulse_jwt_secret_value_0123456789',
  SUPER_ADMIN_SECRET: 'garagepulse_admin_secret_value_0123456789',
  MYGARAGE_DATABASE_URL: 'postgresql://u:p@localhost:5432/mg',
  MYGARAGE_JWT_SECRET: 'mygarage_jwt_secret_value_0123456789ab',
  MYGARAGE_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
  MYGARAGE_GOOGLE_WEB_CLIENT_ID: 'client.apps.googleusercontent.com',
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'key',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_BUCKET: 'bucket'
} as NodeJS.ProcessEnv;

describe('loadMyGarageEnv', () => {
  it('returns null when any variable is missing', () => { expect(loadMyGarageEnv({ ...FULL, R2_BUCKET: undefined })).toBeNull(); });
  it('returns null when the master key is not 32 bytes', () => { expect(loadMyGarageEnv({ ...FULL, MYGARAGE_MASTER_KEY: Buffer.alloc(16).toString('base64') })).toBeNull(); });
  it('returns null when the jwt secret equals JWT_SECRET', () => { expect(loadMyGarageEnv({ ...FULL, MYGARAGE_JWT_SECRET: FULL.JWT_SECRET })).toBeNull(); });
  it('returns null when the jwt secret equals SUPER_ADMIN_SECRET', () => { expect(loadMyGarageEnv({ ...FULL, MYGARAGE_JWT_SECRET: FULL.SUPER_ADMIN_SECRET })).toBeNull(); });
  it('returns null when the jwt secret is under 32 characters', () => { expect(loadMyGarageEnv({ ...FULL, MYGARAGE_JWT_SECRET: 'short' })).toBeNull(); });
  it('parses a complete set', () => { expect(loadMyGarageEnv(FULL)?.masterKey.length).toBe(32); });
});

describe('MyGarage turned off', () => {
  beforeEach(() => { setMgDb(null); setMyGarageEnv(null); });
  it('answers 503 with a plain message', async () => {
    const res = await request(app).get('/api/mygarage/me');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ success: false, message: 'Sync is unavailable right now. Try again later.' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
  it('leaves GaragePulse serving', async () => { expect((await request(app).get('/api/health')).status).toBe(200); });
  it('connectMyGarage resolves false without exiting when settings are missing', async () => {
    const exit = vi.spyOn(process, 'exit');
    await expect(connectMyGarage()).resolves.toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });
});

describe('connectMyGarage pool', () => {
  afterEach(() => {
    vi.doUnmock('pg');
    vi.resetModules();
    vi.unstubAllEnvs();
  });
  it('listens for pool errors so an idle client error cannot crash the process', async () => {
    const pools: EventEmitter[] = [];
    vi.resetModules();
    vi.doMock('pg', () => ({
      Pool: class extends EventEmitter {
        constructor() { super(); pools.push(this); }
        async end() { /* nothing to close */ }
      }
    }));
    const dbMod = await import('../config/db.js');
    for (const [key, value] of Object.entries(FULL)) vi.stubEnv(key, value);
    // The stub has no server behind it, so migration fails and connect returns false.
    await expect(dbMod.connectMyGarage()).resolves.toBe(false);
    expect(pools).toHaveLength(1);
    expect(pools[0].listenerCount('error')).toBeGreaterThan(0);
    expect(() => pools[0].emit('error', new Error('idle client'))).not.toThrow();
  });
});
