import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../../app';
import { authHeader } from '../../tests/helpers/factories';
import { testDb, useMyGarageDb } from './harness';
import { garageInvites, garageMembers } from '../config/schema';
import { hashToken } from '../services/crypto';
import * as mailer from '../services/mailer';

const ACCOUNTS: Record<string, { sub: string; email: string; name?: string }> = {
  owner: { sub: 'g-1', email: 'owner@example.com', name: 'Dinson' },
  anu: { sub: 'g-2', email: 'anu@gmail.com' },
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
});
