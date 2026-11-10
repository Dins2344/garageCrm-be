import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../../app';
import { authHeader } from '../../tests/helpers/factories';
import { testDb, useMyGarageDb } from './harness';
import { garageInvites, garageMembers } from '../config/schema';
import { inviteStore } from '../middleware/rateLimit';
import { hashToken } from '../services/crypto';
import * as mailer from '../services/mailer';
import logger from '../../utils/logger';
import { setMyGarageEnv } from '../config/env';
import { TEST_ENV } from './harness';

const ACCOUNTS: Record<string, { sub: string; email: string; name?: string }> = {
  owner: { sub: 'g-1', email: 'owner@example.com', name: 'Dinson' },
  anu: { sub: 'g-2', email: 'anu@gmail.com' },
  anuk: { sub: 'g-5', email: 'anuk@gmail.com' },
  bob: { sub: 'g-3', email: 'bob@example.com', name: 'Bob' }
};
vi.mock('../services/google', () => ({
  verifyGoogleIdToken: vi.fn(async (idToken: string) => ACCOUNTS[idToken] ?? { sub: idToken, email: `${idToken}@example.com` })
}));
vi.mock('../services/mailer', () => ({ mailerReady: vi.fn(() => true), sendInviteMail: vi.fn(async () => undefined) }));

useMyGarageDb();

const G = '0190a1b2-c3d4-7e5f-8a6b-1234567890a1';
const BASE = '/api/mygarage/v2';
const sign = async (who: string) => (await request(app).post('/api/mygarage/auth/google').send({ idToken: who })).body.data;
const call = (method: 'get' | 'post' | 'delete', path: string, token: string) => request(app)[method](`${BASE}${path}`).set(authHeader(token));
const invite = (token: string, email = 'Anu@Gmail.com', role = 'editor') =>
  call('post', `/garages/${G}/invites`, token).send({ email, role, garageName: 'Family cars' });
const sent = () => vi.mocked(mailer.sendInviteMail).mock.calls.map((c) => c[0]);
const tokenOf = () => sent().at(-1)!.link.split('/').pop()!;
const setup = async () => {
  const owner = await sign('owner');
  const anu = await sign('anu');
  const bob = await sign('bob');
  await call('post', `/garages/${G}/share`, owner.accessToken);
  return { owner, anu, bob };
};
const memberIds = async () => (await testDb.select().from(garageMembers).where(eq(garageMembers.garageId, G))).map((m) => m.userId);
const GONE = 'This invite is no longer valid.';

beforeEach(() => {
  vi.mocked(mailer.mailerReady).mockReset().mockReturnValue(true);
  vi.mocked(mailer.sendInviteMail).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('MyGarage invites', () => {
  it('owner invites; the mail goes to the lowercased address with the link, names and IST expiry', async () => {
    const { owner } = await setup();
    const before = Date.now();
    const res = await invite(owner.accessToken);
    expect(res.status).toBe(201);
    const [mail] = sent();
    expect(mail).toMatchObject({ to: 'anu@gmail.com', inviterName: 'Dinson', garageName: 'Family cars', role: 'editor' });
    expect(mail.link).toMatch(/^https:\/\/dctech\.space\/api\/mygarage\/invite\/[A-Za-z0-9_-]{43}$/);
    const expires = new Date(res.body.data.expiresAt).getTime();
    expect(expires - before).toBeGreaterThanOrEqual(12 * 3600 * 1000);
    expect(expires - before).toBeLessThan(12 * 3600 * 1000 + 5000);
    expect(mail.expiresAt.getTime()).toBe(expires);
    const [row] = await testDb.select().from(garageInvites);
    expect(row.tokenHash).toBe(hashToken(tokenOf()));
    expect(row.email).toBe('anu@gmail.com');
  });

  it('create refuses: not owner, own email, existing member, pending duplicate, 10 members, 10 pending', async () => {
    const { owner, anu, bob } = await setup();
    expect((await invite(anu.accessToken)).status).toBe(403);
    const own = await invite(owner.accessToken, ' Owner@example.com ');
    expect([own.status, own.body.message]).toEqual([400, "You can't invite yourself."]);
    await testDb.insert(garageMembers).values({ garageId: G, userId: bob.user.id, role: 'viewer' });
    const member = await invite(owner.accessToken, 'bob@example.com');
    expect([member.status, member.body.message]).toEqual([409, 'This person already has access.']);
    expect((await invite(owner.accessToken)).status).toBe(201);
    const dup = await invite(owner.accessToken, 'anu@gmail.com');
    expect([dup.status, dup.body.message]).toEqual([409, 'An invite to this email is already waiting. Resend it instead.']);

    for (let i = 0; i < 9; i++) expect((await invite(owner.accessToken, `p${i}@example.com`)).status).toBe(201);
    const pending = await invite(owner.accessToken, 'p9@example.com');
    expect([pending.status, pending.body.message]).toEqual([429, 'Too many invites waiting. Cancel some first.']);

    await testDb.update(garageInvites).set({ status: 'cancelled' });
    for (let i = 0; i < 9; i++) {
      const u = await sign(`m${i}`);
      await testDb.insert(garageMembers).values({ garageId: G, userId: u.user.id, role: 'viewer' });
    }
    const full = await invite(owner.accessToken, 'late@example.com');
    expect([full.status, full.body.message]).toEqual([409, 'This garage already has 10 people.']);
  });

  it('create answers 503 when the mailer is not ready, and 502 with no invite left when sending throws', async () => {
    const { owner } = await setup();
    vi.mocked(mailer.mailerReady).mockReturnValue(false);
    const off = await invite(owner.accessToken);
    expect([off.status, off.body.message]).toEqual([503, 'Inviting is unavailable right now. Try again later.']);
    vi.mocked(mailer.mailerReady).mockReturnValue(true);
    vi.mocked(mailer.sendInviteMail).mockRejectedValue(new Error('smtp down'));
    const failed = await invite(owner.accessToken);
    expect([failed.status, failed.body.message]).toEqual([502, 'Could not send the invite email. Try again.']);
    expect(await testDb.select().from(garageInvites)).toHaveLength(0);
  });

  it('GET /v2/invites lists pending invites for " Anu@Gmail.com " to the account anu@gmail.com', async () => {
    const { owner, anu, bob } = await setup();
    await invite(owner.accessToken, ' Anu@Gmail.com ', 'viewer');
    const list = await call('get', '/invites', anu.accessToken);
    expect(list.status).toBe(200);
    expect(list.body.data.invites).toMatchObject([{ garageId: G, garageName: 'Family cars', inviterName: 'Dinson', role: 'viewer' }]);
    expect(list.body.data.invites[0].id).toBeTruthy();
    expect((await call('get', '/invites', bob.accessToken)).body.data.invites).toEqual([]);
  });

  it("accept by id adds the member with the invite's role; decline adds nothing", async () => {
    const { owner, anu, bob } = await setup();
    const id = (await invite(owner.accessToken, 'anu@gmail.com', 'viewer')).body.data.id;
    const ok = await call('post', `/invites/${id}/accept`, anu.accessToken);
    expect(ok.body.data).toEqual({ garageId: G, role: 'viewer' });
    expect(await memberIds()).toContain(anu.user.id);
    expect((await call('post', `/invites/${id}/accept`, anu.accessToken)).status).toBe(404);

    const id2 = (await invite(owner.accessToken, 'bob@example.com')).body.data.id;
    expect((await call('post', `/invites/${id2}/decline`, bob.accessToken)).status).toBe(200);
    expect(await memberIds()).not.toContain(bob.user.id);
    expect((await call('post', `/invites/${id2}/accept`, bob.accessToken)).status).toBe(404);
  });

  it('accept-link with the token adds the member', async () => {
    const { owner, anu } = await setup();
    await invite(owner.accessToken);
    const res = await call('post', '/invites/accept-link', anu.accessToken).send({ token: tokenOf() });
    expect(res.body.data).toEqual({ garageId: G, role: 'editor' });
    expect(await memberIds()).toContain(anu.user.id);
    const unknown = await call('post', '/invites/accept-link', anu.accessToken).send({ token: 'x'.repeat(43) });
    expect([unknown.status, unknown.body.message]).toEqual([404, GONE]);
  });

  it('accept by another account gets the masked wrong-account message and adds nothing', async () => {
    const { owner, bob } = await setup();
    const id = (await invite(owner.accessToken)).body.data.id;
    const byId = await call('post', `/invites/${id}/accept`, bob.accessToken);
    expect([byId.status, byId.body.message]).toEqual([403, 'This invite is for a***@gmail.com. Sign in with that Google account to accept.']);
    expect((await call('post', '/invites/accept-link', bob.accessToken).send({ token: tokenOf() })).status).toBe(403);
    expect((await call('post', `/invites/${id}/decline`, bob.accessToken)).status).toBe(403);
    expect(await memberIds()).not.toContain(bob.user.id);
    expect(await testDb.select().from(garageInvites)).toMatchObject([{ status: 'pending' }]);
  });

  it("accept at expiresAt gets the expired message with the inviter's name", async () => {
    const { owner } = await setup();
    const res = await invite(owner.accessToken);
    const at = new Date(res.body.data.expiresAt).getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at - 1);
    const anu = await sign('anu'); // a fresh access token for the moved clock
    expect((await call('get', '/invites', anu.accessToken)).body.data.invites).toHaveLength(1);
    vi.setSystemTime(at);
    expect((await call('get', '/invites', anu.accessToken)).body.data.invites).toHaveLength(0);
    const late = await call('post', `/invites/${res.body.data.id}/accept`, anu.accessToken);
    expect([late.status, late.body.message]).toEqual([410, 'This invite has expired. Ask Dinson to send a new one.']);
    const byLink = await call('post', '/invites/accept-link', anu.accessToken).send({ token: tokenOf() });
    expect(byLink.status).toBe(410);
    expect(await memberIds()).not.toContain(anu.user.id);
  });

  it('accept after cancel, and the old token after resend, get "no longer valid"', async () => {
    const { owner, anu } = await setup();
    const id = (await invite(owner.accessToken)).body.data.id;
    const oldToken = tokenOf();
    expect((await call('post', `/invites/${id}/resend`, owner.accessToken)).status).toBe(200);
    const stale = await call('post', '/invites/accept-link', anu.accessToken).send({ token: oldToken });
    expect([stale.status, stale.body.message]).toEqual([404, GONE]);
    expect((await call('delete', `/invites/${id}`, owner.accessToken)).status).toBe(200);
    for (const res of [
      await call('post', `/invites/${id}/accept`, anu.accessToken),
      await call('post', '/invites/accept-link', anu.accessToken).send({ token: tokenOf() }),
      await call('post', `/invites/${id}/resend`, owner.accessToken),
      await call('delete', `/invites/${id}`, owner.accessToken)
    ]) expect([res.status, res.body.message]).toEqual([404, GONE]);
    expect(await memberIds()).not.toContain(anu.user.id);
  });

  it('accept refuses a garage that already has 10 people and leaves the invite pending', async () => {
    const { owner, anu } = await setup();
    await invite(owner.accessToken);
    for (let i = 0; i < 10; i++) {
      const u = await sign(`m${i}`);
      await testDb.insert(garageMembers).values({ garageId: G, userId: u.user.id, role: 'viewer' });
    }
    const id = (await testDb.select().from(garageInvites))[0].id;
    for (const res of [
      await call('post', `/invites/${id}/accept`, anu.accessToken),
      await call('post', '/invites/accept-link', anu.accessToken).send({ token: tokenOf() })
    ]) expect([res.status, res.body.message]).toEqual([409, 'This garage already has 10 people.']);
    expect(await memberIds()).not.toContain(anu.user.id);
    expect(await testDb.select().from(garageInvites)).toMatchObject([{ status: 'pending' }]);
  });

  it('resend issues a new token and 12 more hours', async () => {
    const { owner, anu } = await setup();
    const id = (await invite(owner.accessToken)).body.data.id;
    const first = tokenOf();
    await testDb.update(garageInvites).set({ expiresAt: new Date(Date.now() + 1000) });
    const before = Date.now();
    const res = await call('post', `/invites/${id}/resend`, owner.accessToken);
    expect(res.status).toBe(200);
    expect(new Date(res.body.data.expiresAt).getTime() - before).toBeGreaterThanOrEqual(12 * 3600 * 1000);
    expect(sent()).toHaveLength(2);
    expect(tokenOf()).not.toBe(first);
    expect((await call('post', `/invites/${id}/resend`, anu.accessToken)).status).toBe(403);
    expect((await call('post', '/invites/accept-link', anu.accessToken).send({ token: tokenOf() })).status).toBe(200);
  });

  it('people lists pending invites with expiry; expired ones are left out', async () => {
    const { owner } = await setup();
    await invite(owner.accessToken);
    await invite(owner.accessToken, 'old@example.com');
    await testDb.update(garageInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(garageInvites.email, 'old@example.com'));
    const people = await call('get', `/garages/${G}/people`, owner.accessToken);
    expect(people.body.data.invites).toMatchObject([{ email: 'anu@gmail.com', role: 'editor' }]);
    expect(people.body.data.invites[0].expiresAt).toBeTruthy();
  });

  it('GET /invite/<token> returns the page with the intent URL and no-referrer; a malformed token gets 404', async () => {
    const token = 'A'.repeat(43);
    const res = await request(app).get(`/api/mygarage/invite/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['content-type']).toMatch(/text\/html/);
    const play = encodeURIComponent('https://play.google.com/store/apps/details?id=com.dctechs.mygarage');
    expect(res.text).toContain(`intent://invite/${token}#Intent;scheme=mygarage;package=com.dctechs.mygarage;S.browser_fallback_url=${play};end`);
    expect(res.text).toContain('Open in MyGarage');
    const script = /<script>([\s\S]*?)<\/script>/.exec(res.text)![1];
    expect(script).not.toContain(token);
    const hash = crypto.createHash('sha256').update(script).digest('base64');
    expect(res.headers['content-security-policy']).toContain(`script-src 'sha256-${hash}'`);
    expect((await request(app).get('/api/mygarage/invite/short')).status).toBe(404);
    expect((await request(app).get(`/api/mygarage/invite/${'A'.repeat(42)}!`)).status).toBe(404);
  });

  it('inviteLimiter refuses the 21st create in an hour', async () => {
    const { owner } = await setup();
    for (let i = 0; i < 20; i++) {
      expect((await invite(owner.accessToken, `p${i}@example.com`)).status).toBe(201);
      if (i % 5 === 4) await testDb.update(garageInvites).set({ status: 'cancelled' });
    }
    const res = await invite(owner.accessToken, 'last@example.com');
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/Too many/);
  });

  it('an expired invite does not block inviting the same address again', async () => {
    const { owner } = await setup();
    const first = await invite(owner.accessToken);
    const at = new Date(first.body.data.expiresAt).getTime();
    expect((await invite(owner.accessToken)).status).toBe(409);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at + 1000);
    const fresh = await sign('owner'); // a fresh access token for the moved clock
    expect((await invite(fresh.accessToken)).status).toBe(201);
  });

  it('accept, decline and cancel delete the invite row', async () => {
    const { owner, anu, bob } = await setup();
    const a = (await invite(owner.accessToken)).body.data.id;
    const b = (await invite(owner.accessToken, 'bob@example.com')).body.data.id;
    const c = (await invite(owner.accessToken, 'c@example.com')).body.data.id;
    await call('post', `/invites/${a}/accept`, anu.accessToken);
    await call('post', `/invites/${b}/decline`, bob.accessToken);
    await call('delete', `/invites/${c}`, owner.accessToken);
    expect(await testDb.select().from(garageInvites)).toHaveLength(0);
    for (const id of [a, b, c]) {
      const res = await call('post', `/invites/${id}/accept`, anu.accessToken);
      expect([res.status, res.body.message]).toEqual([404, GONE]);
    }
  });

  it('creating an invite purges invites expired more than 3 days ago, in any garage, and keeps newer ones', async () => {
    const { owner } = await setup();
    const id1 = (await invite(owner.accessToken, 'old@example.com')).body.data.id;
    const id2 = (await invite(owner.accessToken, 'recent@example.com')).body.data.id;
    await testDb.update(garageInvites).set({ expiresAt: new Date(Date.now() - 4 * 86400000) }).where(eq(garageInvites.id, id1));
    await testDb.update(garageInvites).set({ expiresAt: new Date(Date.now() - 2 * 86400000) }).where(eq(garageInvites.id, id2));
    expect((await invite(owner.accessToken, 'new@example.com')).status).toBe(201);
    const ids = (await testDb.select().from(garageInvites)).map((r) => r.id);
    expect(ids).not.toContain(id1);
    expect(ids).toContain(id2);
  });

  it('within the 3 days the expired message still works', async () => {
    const { owner, anu } = await setup();
    const id = (await invite(owner.accessToken)).body.data.id;
    await testDb.update(garageInvites).set({ expiresAt: new Date(Date.now() - 2 * 86400000) });
    const res = await call('post', `/invites/${id}/accept`, anu.accessToken);
    expect([res.status, res.body.message]).toEqual([410, 'This invite has expired. Ask Dinson to send a new one.']);
  });

  it('an invite to Anu.K+cars@googlemail.com is listed for and accepted by anuk@gmail.com; other domains compare exactly', async () => {
    const { owner } = await setup();
    const anuk = await sign('anuk');
    const id = (await invite(owner.accessToken, 'Anu.K+cars@googlemail.com')).body.data.id;
    expect((await invite(owner.accessToken, 'anuk@gmail.com')).status).toBe(409);
    expect((await call('get', '/invites', anuk.accessToken)).body.data.invites).toHaveLength(1);
    const ok = await call('post', `/invites/${id}/accept`, anuk.accessToken);
    expect(ok.body.data).toEqual({ garageId: G, role: 'editor' });
    expect((await invite(owner.accessToken, 'a.nu.k@gmail.com')).body.message).toBe('This person already has access.');

    const ab = await sign('ab');
    await invite(owner.accessToken, 'a.b@example.com');
    expect((await call('get', '/invites', ab.accessToken)).body.data.invites).toEqual([]);
  });

  it('invite ids are random UUIDs', async () => {
    const { owner } = await setup();
    const id = (await invite(owner.accessToken)).body.data.id;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('one user gets 20 invite emails a day, then 429 with the daily message', async () => {
    const { owner } = await setup();
    for (let i = 0; i < 20; i++) {
      expect((await invite(owner.accessToken, `p${i}@example.com`)).status).toBe(201);
      if (i % 5 === 4) {
        await testDb.delete(garageInvites);
        await inviteStore.resetAll(); // the hourly limiter would trip first
      }
    }
    const res = await invite(owner.accessToken, 'last@example.com');
    expect([res.status, res.body.message]).toEqual([429, 'Too many invites today. Try again tomorrow.']);
    expect(sent()).toHaveLength(20);
  });

  it('the whole server sends at most 100 invite emails a day, then 503', async () => {
    for (let o = 0; o < 5; o++) {
      const owner = await sign(`own${o}`);
      const gid = `0190a1b2-c3d4-7e5f-8a6b-1234567890b${o}`;
      await call('post', `/garages/${gid}/share`, owner.accessToken);
      for (let i = 0; i < 20; i++) {
        const res = await call('post', `/garages/${gid}/invites`, owner.accessToken).send({ email: `x${o}-${i}@example.com`, role: 'viewer', garageName: 'G' });
        expect(res.status).toBe(201);
        if (i % 5 === 4) await testDb.delete(garageInvites);
      }
    }
    const late = await sign('own9');
    await call('post', `/garages/${G}/share`, late.accessToken);
    const res = await invite(late.accessToken, 'z@example.com');
    expect([res.status, res.body.message]).toEqual([503, 'Inviting is unavailable right now. Try again later.']);
    expect(sent()).toHaveLength(100);
  }, 60000);

  it('a failed send logs the SMTP codes and ids, never the address or message text', async () => {
    const { owner } = await setup();
    vi.mocked(mailer.sendInviteMail).mockRejectedValue(Object.assign(new Error('rejected anu@gmail.com'), { code: 'EAUTH', responseCode: 535 }));
    const spy = vi.spyOn(logger, 'write');
    const res = await invite(owner.accessToken);
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(res.status).toBe(502);
    expect(logged).toContain('EAUTH');
    expect(logged).toContain('535');
    expect(logged).not.toContain('anu@gmail');
  });

  it('the link page answers while MyGarage is not ready, and the rest still gets 503', async () => {
    setMyGarageEnv(null);
    try {
      const page = await request(app).get(`/api/mygarage/invite/${'A'.repeat(43)}`);
      expect([page.status, page.headers['cache-control']]).toEqual([200, 'no-store']);
      expect((await request(app).get(`${BASE}/invites`)).status).toBe(503);
    } finally {
      setMyGarageEnv(TEST_ENV);
    }
  });
});
