import { describe, it, expect, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../app';
import { parseVersionRule } from '../controllers/appController';
import { isMyGarageReady } from '../config/db';

describe('app version rule', () => {
  afterEach(() => {
    delete process.env.MYGARAGE_MIN_VERSION_CODE;
    delete process.env.MYGARAGE_BLOCKED_VERSION_CODES;
    delete process.env.MYGARAGE_REFERRALS;
  });

  it('reads the minimum and the blocked builds, ignoring anything unreadable', () => {
    expect(parseVersionRule({})).toEqual({ minVersionCode: 0, blockedVersionCodes: [] });
    expect(parseVersionRule({ MYGARAGE_MIN_VERSION_CODE: ' 9 ', MYGARAGE_BLOCKED_VERSION_CODES: '10, 11,,x,-3' }))
      .toEqual({ minVersionCode: 9, blockedVersionCodes: [10, 11] });
    expect(parseVersionRule({ MYGARAGE_MIN_VERSION_CODE: 'nine' }).minVersionCode).toBe(0);
  });

  it('answers without sign-in, and while sync is unavailable', async () => {
    process.env.MYGARAGE_MIN_VERSION_CODE = '9';
    process.env.MYGARAGE_BLOCKED_VERSION_CODES = '11';
    expect(isMyGarageReady()).toBe(false); // no MyGarage settings in this file: every other route answers 503
    const res = await request(app).get('/api/mygarage/v2/app/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { minVersionCode: 9, blockedVersionCodes: [11], referrals: false } });
  });

  it('tells the app whether referrals are on, read per request', async () => {
    process.env.MYGARAGE_REFERRALS = 'true';
    const on = await request(app).get('/api/mygarage/v2/app/version');
    expect(on.body.data.referrals).toBe(true);
    delete process.env.MYGARAGE_REFERRALS;
    const off = await request(app).get('/api/mygarage/v2/app/version');
    expect(off.body.data.referrals).toBe(false);
  });
});
