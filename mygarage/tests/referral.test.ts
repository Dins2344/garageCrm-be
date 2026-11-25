import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { and, eq, isNull } from 'drizzle-orm';
import app from '../../app';
import { authHeader } from '../../tests/helpers/factories';
import { testDb, useMyGarageDb, TEST_ENV } from './harness';
import { garageMembers, plusGrants, referrals, sharedGarages, subscriptions, users } from '../config/schema';
import { setMyGarageEnv } from '../config/env';
import { REFERRAL_CODE_RE } from '../models/Referral';
import * as play from '../services/play';

vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) => ({ sub: idToken, email: `${idToken}@example.com`, name: idToken }))
}));
vi.mock('../services/mailer', () => ({ mailerReady: vi.fn(() => true), sendInviteMail: vi.fn(async () => undefined) }));
vi.mock('../services/play', async (original) => ({
  ...(await original<typeof import('../services/play')>()),
  getSubscription: vi.fn(),
  deferSubscription: vi.fn(async () => undefined),
  acknowledge: vi.fn(async () => undefined)
}));

useMyGarageDb();

type Who = { accessToken: string; user: { id: string } };
const BASE = '/api/mygarage/v2';
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;
const sign = async (who: string): Promise<Who> => (await request(app).post('/api/mygarage/auth/google').send({ idToken: who })).body.data;
const status = (w: Who) => request(app).get(`${BASE}/referral`).set(authHeader(w.accessToken));
const codeOf = async (w: Who): Promise<string> => (await status(w)).body.data.code;
const redeem = (w: Who, body: object) => request(app).post(`${BASE}/referral/redeem`).set(authHeader(w.accessToken)).send(body);
const redeemed = async (w: Who, code: string) => (await redeem(w, { code, source: 'typed' })).body.data?.result;
const activate = async (w: Who) => (await request(app).post(`${BASE}/referral/activate`).set(authHeader(w.accessToken))).body.data?.result;
const entitlement = async (w: Who) => (await request(app).get(`${BASE}/billing/entitlement`).set(authHeader(w.accessToken))).body.data;
const grants = (userId?: string) => testDb.select().from(plusGrants).where(userId ? eq(plusGrants.userId, userId) : undefined);
const near = (iso: string | null, ms: number) => expect(Math.abs(Date.parse(iso ?? '') - (Date.now() + ms))).toBeLessThan(MIN);
const fillCap = (userId: string, n: number) =>
  testDb.insert(plusGrants).values(Array.from({ length: n }, () => ({ userId, reason: 'referral' as const, days: 30, startsAt: new Date(), endsAt: new Date(Date.now() + 30 * DAY) })));
const playRow = (userId: string, state: string, autoRenew: boolean, inMs: number) =>
  testDb.insert(subscriptions).values({ purchaseToken: 'tok-1', userId, productId: 'plus', state, expiresAt: new Date(Date.now() + inMs), autoRenew });

/** A referrer and a friend who has redeemed the referrer's code. */
const pair = async (): Promise<{ r: Who; f: Who }> => {
  const r = await sign('r');
  const f = await sign('f');
  expect(await redeemed(f, await codeOf(r))).toBe('pending');
  return { r, f };
};

beforeEach(() => {
  vi.mocked(play.getSubscription).mockReset();
  vi.mocked(play.deferSubscription).mockReset().mockResolvedValue(undefined);
});
afterEach(() => setMyGarageEnv(TEST_ENV));

describe('code and status', () => {
  it('makes a code once and keeps it', async () => {
    const a = await sign('a');
    const first = await status(a);
    expect(first.status).toBe(200);
    expect(first.body.data.code).toMatch(REFERRAL_CODE_RE);
    expect(first.body.data).toMatchObject({
      enabled: true, joined: 0, rewarded: 0, daysEarned: 0, capLeft: 12, canRedeem: true,
      link: `https://play.google.com/store/apps/details?id=com.dctechs.mygarage&referrer=${first.body.data.code}`
    });
    expect(await codeOf(a)).toBe(first.body.data.code);
  });

  it('counts joined and rewarded friends', async () => {
    const { r, f } = await pair();
    expect((await status(r)).body.data).toMatchObject({ joined: 1, rewarded: 0 });
    await activate(f);
    expect((await status(r)).body.data).toMatchObject({ joined: 1, rewarded: 1, daysEarned: 30, capLeft: 11 });
    expect((await status(f)).body.data.canRedeem).toBe(false);
  });
});

describe('switched off', () => {
  it('says so, refuses redeem and activates nothing', async () => {
    const { f } = await pair();
    setMyGarageEnv({ ...TEST_ENV, referrals: false });
    expect((await status(f)).body.data).toEqual({ enabled: false });
    expect((await redeem(f, { code: 'MG-ABCDE', source: 'typed' })).status).toBe(404);
    expect(await activate(f)).toBe('none');
    expect(await grants()).toHaveLength(0);
  });
});

describe('redeem', () => {
  it('turns down unknown and malformed codes', async () => {
    const a = await sign('a');
    expect(await redeemed(a, 'MG-00000')).toBe('invalid');
    expect(await redeemed(a, 'MG-ABCDE')).toBe('invalid');
    expect(await redeemed(a, 'junk')).toBe('invalid');
  });

  it('turns down the caller’s own code', async () => {
    const a = await sign('a');
    expect(await redeemed(a, await codeOf(a))).toBe('own_code');
  });

  it('accepts lowercase with spaces', async () => {
    const r = await sign('r');
    const f = await sign('f');
    expect(await redeemed(f, ` ${(await codeOf(r)).toLowerCase()} `)).toBe('pending');
  });

  it('allows one referral per account', async () => {
    const { f } = await pair();
    const other = await sign('o');
    expect(await redeemed(f, await codeOf(other))).toBe('not_eligible');
  });

  it('only in the first 7 days', async () => {
    const r = await sign('r');
    const f = await sign('f');
    await testDb.update(users).set({ createdAt: new Date(Date.now() - 8 * DAY) }).where(eq(users.id, f.user.id));
    expect(await redeemed(f, await codeOf(r))).toBe('not_eligible');
    expect((await status(f)).body.data.canRedeem).toBe(false);
  });

  it('answers 400 to a bad body', async () => {
    const a = await sign('a');
    const res = await redeem(a, { code: 1 });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Code request was not valid.');
  });
});

describe('activate', () => {
  it('does nothing without a referral', async () => {
    const a = await sign('a');
    expect(await activate(a)).toBe('none');
  });

  it('gives both people 30 days of Plus, once', async () => {
    const { r, f } = await pair();
    expect(await activate(f)).toBe('rewarded');
    for (const w of [r, f]) {
      const e = await entitlement(w);
      expect(e).toMatchObject({ plus: true, autoRenew: false, adFree: true });
      near(e.freeUntil, 30 * DAY);
      expect(e.until).toBe(e.freeUntil);
    }
    expect(await activate(f)).toBe('none');
    expect(await grants()).toHaveLength(2);
  });

  it('pays once when two calls race', async () => {
    const { f } = await pair();
    const results = await Promise.all([activate(f), activate(f)]);
    expect(results.sort()).toEqual(['none', 'rewarded']);
    expect(await grants()).toHaveLength(2);
  });

  it('stops paying the referrer at the yearly cap', async () => {
    const { r, f } = await pair();
    await fillCap(r.user.id, 12);
    expect(await activate(f)).toBe('rewarded');
    expect(await grants(r.user.id)).toHaveLength(12);
    expect(await grants(f.user.id)).toHaveLength(1);
    expect((await testDb.select().from(referrals))[0].referrerCapped).toBe(true);
    expect((await status(r)).body.data).toMatchObject({ capLeft: 0, rewarded: 0 });
  });

  it('a friend’s own reward does not use their cap as a referrer', async () => {
    const { f } = await pair();
    await activate(f);
    expect((await status(f)).body.data.capLeft).toBe(12);
  });

  it('a friend who deletes and returns can redeem again, but the cap still holds', async () => {
    const { r, f } = await pair();
    await fillCap(r.user.id, 11);
    expect(await activate(f)).toBe('rewarded');
    expect(await grants(r.user.id)).toHaveLength(12);

    expect((await request(app).delete('/api/mygarage/account').set(authHeader(f.accessToken))).status).toBe(200);
    const orphaned = await testDb.select().from(plusGrants).where(and(eq(plusGrants.userId, r.user.id), isNull(plusGrants.referralId)));
    expect(orphaned).toHaveLength(12); // the earned grant lost its referral but stays
    expect((await status(r)).body.data.capLeft).toBe(0);

    const back = await sign('f');
    expect(back.user.id).not.toBe(f.user.id);
    expect(await redeemed(back, await codeOf(r))).toBe('pending');
    expect(await activate(back)).toBe('rewarded');
    expect(await grants(r.user.id)).toHaveLength(12);
    expect(await grants(back.user.id)).toHaveLength(1);
  });

  it('rewards the friend when the referrer has deleted their account', async () => {
    const { r, f } = await pair();
    expect((await request(app).delete('/api/mygarage/account').set(authHeader(r.accessToken))).status).toBe(200);
    expect(await activate(f)).toBe('rewarded');
    expect(await grants()).toHaveLength(1);
  });
});

describe('how days are applied', () => {
  it('stacks after paid time that will not renew', async () => {
    const { f } = await pair();
    await playRow(f.user.id, 'SUBSCRIPTION_STATE_CANCELED', false, 10 * DAY);
    expect(await activate(f)).toBe('rewarded');
    const [g] = await grants(f.user.id);
    expect(g.startsAt.getTime() - Date.now()).toBeGreaterThan(10 * DAY - MIN);
    const e = await entitlement(f);
    expect(e.plus).toBe(true);
    near(e.until, 40 * DAY);
    expect(e.freeUntil).toBe(e.until);
    expect(play.getSubscription).not.toHaveBeenCalled();
  });

  it('stacks after earlier free days', async () => {
    const { f } = await pair();
    await fillCap(f.user.id, 1);
    await activate(f);
    near((await entitlement(f)).until, 60 * DAY);
  });

  it('defers the next charge of an auto-renewing subscriber', async () => {
    const { f } = await pair();
    await playRow(f.user.id, 'SUBSCRIPTION_STATE_ACTIVE', true, 10 * DAY);
    vi.mocked(play.getSubscription).mockResolvedValue({
      subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', etag: 'etag-1',
      lineItems: [{ productId: 'plus', expiryTime: new Date(Date.now() + 10 * DAY).toISOString(), autoRenewingPlan: { autoRenewEnabled: true } }]
    });
    expect(await activate(f)).toBe('rewarded');
    expect(play.deferSubscription).toHaveBeenCalledExactlyOnceWith('tok-1', 'etag-1', 30);
    const [g] = await grants(f.user.id);
    expect(g.deferredToken).toBe('tok-1');
    const e = await entitlement(f);
    expect(e).toMatchObject({ plus: true, autoRenew: true, freeUntil: null });
    near(e.until, 40 * DAY);
  });

  it('stacks the days when Play refuses the deferral', async () => {
    const { f } = await pair();
    await playRow(f.user.id, 'SUBSCRIPTION_STATE_ACTIVE', true, 10 * DAY);
    vi.mocked(play.getSubscription).mockResolvedValue({ etag: 'etag-1', lineItems: [{ expiryTime: new Date(Date.now() + 10 * DAY).toISOString() }] });
    vi.mocked(play.deferSubscription).mockRejectedValue(new Error('play 500'));
    expect(await activate(f)).toBe('rewarded');
    const [g] = await grants(f.user.id);
    expect(g.deferredToken).toBeNull();
    near(g.endsAt.toISOString(), 40 * DAY);
    near((await entitlement(f)).freeUntil, 40 * DAY);
  });

  it('gives a member of a garage owned by someone on free days no ads', async () => {
    const o = await sign('o');
    const m = await sign('m');
    await fillCap(o.user.id, 1);
    await testDb.insert(sharedGarages).values({ id: '0190a1b2-c3d4-7e5f-8a6b-1234567890a1', ownerId: o.user.id, wrappedKey: 'k' });
    await testDb.insert(garageMembers).values({ garageId: '0190a1b2-c3d4-7e5f-8a6b-1234567890a1', userId: m.user.id, role: 'editor' });
    expect(await entitlement(m)).toMatchObject({ plus: false, adFree: true, freeUntil: null });
  });

  it('a grant that has not started yet, after a gap, gives nothing now', async () => {
    const a = await sign('a');
    await testDb.insert(plusGrants).values({ userId: a.user.id, reason: 'referral', days: 30, startsAt: new Date(Date.now() + DAY), endsAt: new Date(Date.now() + 31 * DAY) });
    expect(await entitlement(a)).toMatchObject({ plus: false, until: null });
  });
});
