import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../../app';
import { authHeader } from '../../tests/helpers/factories';
import { testDb, useMyGarageDb, TEST_ENV } from './harness';
import { subscriptions } from '../config/schema';
import { loadPlaySettings, setMyGarageEnv } from '../config/env';
import { grantsPlus } from '../usecases/billingUsecase';
import * as play from '../services/play';
import type { PlaySubscription } from '../services/play';

vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) => ({ sub: idToken, email: `${idToken}@example.com`, name: idToken }))
}));
vi.mock('../services/mailer', () => ({ mailerReady: vi.fn(() => true), sendInviteMail: vi.fn(async () => undefined) }));
vi.mock('../services/play', async (original) => ({
  ...(await original<typeof import('../services/play')>()),
  getSubscription: vi.fn(),
  acknowledge: vi.fn(async () => undefined),
  isPlayPush: vi.fn(async (auth?: string) => auth === 'Bearer google')
}));

useMyGarageDb();

const BASE = '/api/mygarage/v2';
const G = '0190a1b2-c3d4-7e5f-8a6b-1234567890a1';
const DAY = 24 * 60 * 60 * 1000;
const sign = async (who: string) => (await request(app).post('/api/mygarage/auth/google').send({ idToken: who })).body.data;
const verify = (token: string, purchaseToken: string) => request(app).post(`${BASE}/billing/verify`).set(authHeader(token)).send({ purchaseToken });
const entitlement = async (token: string) => (await request(app).get(`${BASE}/billing/entitlement`).set(authHeader(token))).body.data;
const notify = (data: unknown, auth = 'Bearer google') =>
  request(app).post(`${BASE}/billing/notifications`).set('Authorization', auth)
    .send({ message: { data: Buffer.from(JSON.stringify(data)).toString('base64'), messageId: '1' }, subscription: 'projects/x/subscriptions/y' });
const subNote = (purchaseToken: string) => ({ packageName: play.PACKAGE, subscriptionNotification: { version: '1.0', notificationType: 2, purchaseToken } });

const playSays = (s: Partial<PlaySubscription> & { owner?: string; expiry?: number } = {}): PlaySubscription => ({
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
  externalAccountIdentifiers: s.owner ? { obfuscatedExternalAccountId: s.owner } : undefined,
  lineItems: [{
    productId: 'plus', expiryTime: new Date(Date.now() + (s.expiry ?? 30 * DAY)).toISOString(),
    autoRenewingPlan: { autoRenewEnabled: true }, offerDetails: { basePlanId: 'yearly' }
  }],
  ...s
});
const answer = (s: PlaySubscription | null) => vi.mocked(play.getSubscription).mockResolvedValue(s);
const rows = () => testDb.select().from(subscriptions);

beforeEach(() => {
  vi.mocked(play.getSubscription).mockReset();
  vi.mocked(play.acknowledge).mockReset().mockResolvedValue(undefined);
  setMyGarageEnv({ ...TEST_ENV, requirePlus: true });
});
afterEach(() => setMyGarageEnv(TEST_ENV));

describe('grantsPlus', () => {
  const later = new Date(Date.now() + DAY);
  const earlier = new Date(Date.now() - DAY);
  it.each([
    ['SUBSCRIPTION_STATE_ACTIVE', later, true],
    ['SUBSCRIPTION_STATE_IN_GRACE_PERIOD', later, true],
    ['SUBSCRIPTION_STATE_CANCELED', later, true],
    ['SUBSCRIPTION_STATE_CANCELED', earlier, false],
    ['SUBSCRIPTION_STATE_CANCELED', null, false],
    ['SUBSCRIPTION_STATE_ON_HOLD', later, false],
    ['SUBSCRIPTION_STATE_PAUSED', later, false],
    ['SUBSCRIPTION_STATE_EXPIRED', earlier, false],
    ['SUBSCRIPTION_STATE_PENDING', later, false],
    ['REVOKED', later, false]
  ] as const)('%s with expiry %s gives %s', (state, expiresAt, plus) => {
    expect(grantsPlus(state, expiresAt)).toBe(plus);
  });
});

describe('loadPlaySettings', () => {
  const key = Buffer.from(JSON.stringify({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: 'k' })).toString('base64');
  const full = { MYGARAGE_PLAY_SERVICE_ACCOUNT: key, MYGARAGE_RTDN_AUDIENCE: 'https://a', MYGARAGE_RTDN_PUSH_EMAIL: 'push@x' };
  it('reads a complete set', () => { expect(loadPlaySettings(full)?.email).toBe('sa@x.iam.gserviceaccount.com'); });
  it('is off when a setting is missing', () => { expect(loadPlaySettings({ ...full, MYGARAGE_RTDN_AUDIENCE: undefined })).toBeNull(); });
  it('is off when the key is not base64 JSON', () => { expect(loadPlaySettings({ ...full, MYGARAGE_PLAY_SERVICE_ACCOUNT: 'nope' })).toBeNull(); });
});

describe('verify', () => {
  it('stores the purchase, acknowledges it once and turns Plus on', async () => {
    const a = await sign('a');
    expect((await entitlement(a.accessToken)).plus).toBe(false);
    answer(playSays({ owner: a.user.id }));
    const res = await verify(a.accessToken, 'tok-1');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ plus: true, autoRenew: true, adFree: true });
    expect(Date.parse(res.body.data.until)).toBeGreaterThan(Date.now());
    expect(play.acknowledge).toHaveBeenCalledExactlyOnceWith('plus', 'tok-1');
    expect(await rows()).toMatchObject([{ purchaseToken: 'tok-1', userId: a.user.id, basePlanId: 'yearly' }]);
  });

  it('does not acknowledge twice', async () => {
    const a = await sign('a');
    answer(playSays({ owner: a.user.id, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }));
    await verify(a.accessToken, 'tok-1');
    expect(play.acknowledge).not.toHaveBeenCalled();
  });

  it('still answers when acknowledging fails, so the notification can retry it', async () => {
    const a = await sign('a');
    answer(playSays({ owner: a.user.id }));
    vi.mocked(play.acknowledge).mockRejectedValue(new Error('play down'));
    expect((await verify(a.accessToken, 'tok-1')).body.data.plus).toBe(true);
  });

  it('refuses a purchase made for another existing account, and stores nothing', async () => {
    const a = await sign('a');
    const b = await sign('b');
    answer(playSays({ owner: a.user.id }));
    const res = await verify(b.accessToken, 'tok-1');
    expect(res.status).toBe(409);
    expect(play.acknowledge).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it('refuses a token already stored for another account', async () => {
    const a = await sign('a');
    const b = await sign('b');
    answer(playSays({ owner: a.user.id }));
    await verify(a.accessToken, 'tok-1');
    answer(playSays()); // no account named
    expect((await verify(b.accessToken, 'tok-1')).status).toBe(409);
  });

  it('gives a purchase to the caller when the account it named was deleted', async () => {
    const b = await sign('b');
    answer(playSays({ owner: 'deleted-user-id' }));
    expect((await verify(b.accessToken, 'tok-1')).body.data.plus).toBe(true);
  });

  it('answers 404 for a token Play does not know', async () => {
    const a = await sign('a');
    answer(null);
    expect((await verify(a.accessToken, 'tok-x')).status).toBe(404);
  });

  it('ends the token an upgrade replaced', async () => {
    const a = await sign('a');
    answer(playSays({ owner: a.user.id }));
    await verify(a.accessToken, 'tok-old');
    answer(playSays({ owner: a.user.id, linkedPurchaseToken: 'tok-old' }));
    await verify(a.accessToken, 'tok-new');
    expect((await rows()).map((r) => r.purchaseToken)).toEqual(['tok-new']);
  });

  it.each([
    ['SUBSCRIPTION_STATE_ON_HOLD', 30 * DAY, false],
    ['SUBSCRIPTION_STATE_CANCELED', 30 * DAY, true],
    ['SUBSCRIPTION_STATE_CANCELED', -DAY, false]
  ] as const)('%s ending in %s ms gives plus %s', async (subscriptionState, expiry, plus) => {
    const a = await sign('a');
    answer(playSays({ owner: a.user.id, subscriptionState, expiry, acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }));
    expect((await verify(a.accessToken, 'tok-1')).body.data.plus).toBe(plus);
  });

  it('answers 503 while purchases are not set up', async () => {
    const a = await sign('a');
    setMyGarageEnv({ ...TEST_ENV, play: null });
    vi.mocked(play.getSubscription).mockImplementation((await vi.importActual<typeof import('../services/play')>('../services/play')).getSubscription);
    expect((await verify(a.accessToken, 'tok-1')).status).toBe(503);
  });

  it('rejects a missing token', async () => {
    const a = await sign('a');
    expect((await request(app).post(`${BASE}/billing/verify`).set(authHeader(a.accessToken)).send({})).status).toBe(400);
  });
});

describe('notifications', () => {
  it('refuses a push without Google’s token', async () => {
    expect((await notify(subNote('tok-1'), 'Bearer someone')).status).toBe(401);
    expect(play.getSubscription).not.toHaveBeenCalled();
  });

  it('updates a stored purchase from Play’s current answer', async () => {
    const a = await sign('a');
    answer(playSays({ owner: a.user.id }));
    await verify(a.accessToken, 'tok-1');
    answer(playSays({ owner: a.user.id, subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED' }));
    expect((await notify(subNote('tok-1'))).status).toBe(204);
    expect((await entitlement(a.accessToken)).plus).toBe(false);
  });

  it('stores and acknowledges a purchase the app never reported', async () => {
    const a = await sign('a');
    answer(playSays({ owner: a.user.id }));
    expect((await notify(subNote('tok-1'))).status).toBe(204);
    expect((await entitlement(a.accessToken)).plus).toBe(true);
    expect(play.acknowledge).toHaveBeenCalledOnce();
  });

  it('ignores a purchase with no MyGarage account', async () => {
    answer(playSays({ owner: 'nobody' }));
    expect((await notify(subNote('tok-1'))).status).toBe(204);
    expect(await rows()).toHaveLength(0);
  });

  it('revokes on a refund, and a later answer does not bring Plus back', async () => {
    const a = await sign('a');
    answer(playSays({ owner: a.user.id }));
    await verify(a.accessToken, 'tok-1');
    await notify({ packageName: play.PACKAGE, voidedPurchaseNotification: { purchaseToken: 'tok-1', productType: 1, refundType: 1 } });
    expect((await entitlement(a.accessToken)).plus).toBe(false);
    await notify(subNote('tok-1'));
    expect((await entitlement(a.accessToken)).plus).toBe(false);
  });

  it('asks Pub/Sub to retry when Play fails', async () => {
    vi.mocked(play.getSubscription).mockRejectedValue(new Error('play down'));
    expect((await notify(subNote('tok-1'))).status).toBe(503);
  });

  it('drops what it cannot use: another app, a test message, a broken body', async () => {
    expect((await notify({ packageName: 'other.app', subscriptionNotification: { purchaseToken: 't' } })).status).toBe(204);
    expect((await notify({ packageName: play.PACKAGE, testNotification: { version: '1.0' } })).status).toBe(204);
    const broken = await request(app).post(`${BASE}/billing/notifications`).set('Authorization', 'Bearer google').send({ message: { data: '%%%' } });
    expect(broken.status).toBe(204);
    expect(play.getSubscription).not.toHaveBeenCalled();
  });
});

describe('sharing needs Plus', () => {
  const share = (token: string) => request(app).post(`${BASE}/garages/${G}/share`).set(authHeader(token));
  const invite = (token: string, email: string) =>
    request(app).post(`${BASE}/garages/${G}/invites`).set(authHeader(token)).send({ email, role: 'editor', garageName: 'Family' });
  const buy = async (who: { accessToken: string; user: { id: string } }, token = 'tok-1') => {
    answer(playSays({ owner: who.user.id }));
    await verify(who.accessToken, token);
  };
  const lapse = (token = 'tok-1') => testDb.update(subscriptions).set({ state: 'SUBSCRIPTION_STATE_EXPIRED' }).where(eq(subscriptions.purchaseToken, token));

  it('refuses to start sharing without Plus', async () => {
    const a = await sign('a');
    const res = await share(a.accessToken);
    expect(res.status).toBe(402);
  });

  it('lets a Plus owner share and invite, and their members see no ads', async () => {
    const a = await sign('a');
    const b = await sign('b');
    await buy(a);
    expect((await share(a.accessToken)).status).toBe(200);
    expect((await invite(a.accessToken, 'b@example.com')).status).toBe(201);
    const [{ id }] = (await request(app).get(`${BASE}/invites`).set(authHeader(b.accessToken))).body.data.invites;
    expect((await request(app).post(`${BASE}/invites/${id}/accept`).set(authHeader(b.accessToken))).status).toBe(200);
    expect(await entitlement(b.accessToken)).toMatchObject({ plus: false, adFree: true });
  });

  it('after the owner lapses: the garage keeps syncing, but no new invites or joins', async () => {
    const a = await sign('a');
    const b = await sign('b');
    await buy(a);
    await share(a.accessToken);
    await invite(a.accessToken, 'b@example.com');
    await lapse();
    expect((await share(a.accessToken)).status).toBe(200); // asking again for its key still works
    expect((await invite(a.accessToken, 'c@example.com')).status).toBe(402);
    const [{ id }] = (await request(app).get(`${BASE}/invites`).set(authHeader(b.accessToken))).body.data.invites;
    const join = await request(app).post(`${BASE}/invites/${id}/accept`).set(authHeader(b.accessToken));
    expect(join.status).toBe(402);
    expect(join.body.message).toMatch(/owner/);
  });

  it('is not checked while MYGARAGE_REQUIRE_PLUS is off', async () => {
    setMyGarageEnv(TEST_ENV);
    const a = await sign('a');
    expect((await share(a.accessToken)).status).toBe(200);
  });
});
