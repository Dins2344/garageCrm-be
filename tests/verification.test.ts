import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import app from '../app';
import { db, schema, findById } from './helpers/dbAccess';
import { createGarageWithOwner, registerGarageOwner, nextPhone, authHeader } from './helpers/factories';
import { sendVerificationEmail } from '../services/emailService';
import { sendSms, isSmsConfigured } from '../services/smsService';
import { maskTarget } from '../usecases/verificationUsecase';
import { MAX_ATTEMPTS } from '../models/VerificationChallenge';

/**
 * The owner verification flow, end to end through the API. Email and SMS are
 * mocked globally in tests/setup.ts and report "not delivered", which outside
 * production means the code is logged and the flow continues — so the tests
 * read the code straight off the mock's arguments, the way a developer reads
 * it off the log.
 */

const emailMock = vi.mocked(sendVerificationEmail);
const smsMock = vi.mocked(sendSms);
const smsConfiguredMock = vi.mocked(isSmsConfigured);

const lastEmailCode = (): string => emailMock.mock.calls.at(-1)![0].code;
const lastSmsCode = (): string => /\b(\d{6})\b/.exec(smsMock.mock.calls.at(-1)![0].body)![1];

const send = (token: string, channel: string) =>
  request(app).post(`/api/auth/verification/${channel}/send`).set(authHeader(token));
const confirm = (token: string, channel: string, code: unknown) =>
  request(app).post(`/api/auth/verification/${channel}/confirm`).set(authHeader(token)).send({ code });

beforeEach(() => {
  emailMock.mockClear();
  smsMock.mockClear();
  smsConfiguredMock.mockReturnValue(false);
});

describe('owner verification: email', () => {
  it('sends a code to a masked address and confirms it', async () => {
    const { token, userId } = await createGarageWithOwner('verify-email');

    const sent = await send(token, 'email');
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({
      status: 'sent', channel: 'email', target: 'o***l@example.com', expiresInSeconds: 600, resendAfterSeconds: 60
    });
    expect(emailMock).toHaveBeenCalledTimes(1);
    expect(emailMock.mock.calls[0][0].to).toBe('owner-verify-email@example.com');

    // The code itself never touches the database in the clear.
    const challenge = await db.query.verificationChallenges.findFirst({ where: eq(schema.verificationChallenges.userId, userId) });
    expect(challenge!.codeHash).not.toContain(lastEmailCode());
    expect(challenge!.codeHash).toHaveLength(64);

    const confirmed = await confirm(token, 'email', lastEmailCode());
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.emailVerifiedAt).toBeTruthy();
    expect(confirmed.body.data.phoneVerifiedAt).toBeNull();
    expect(confirmed.body.data.password).toBeUndefined();

    const me = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(me.body.data.emailVerifiedAt).toBeTruthy();

    const status = await request(app).get('/api/auth/verification').set(authHeader(token));
    expect(status.status).toBe(200);
    expect(status.body.data.email.verifiedAt).toBeTruthy();
    expect(status.body.data.phone.verifiedAt).toBeNull();
  });

  it('accepts the code with surrounding whitespace, and as a number', async () => {
    const { token } = await createGarageWithOwner('verify-lenient');
    await send(token, 'email');
    const code = lastEmailCode();

    const res = await confirm(token, 'email', ` ${code} `);
    expect(res.status).toBe(200);
  });

  it('rejects a wrong code, counts down the attempts, and burns the code on the last one', async () => {
    const { token } = await createGarageWithOwner('verify-wrong');
    await send(token, 'email');
    const code = lastEmailCode();
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const res = await confirm(token, 'email', wrong);
      expect(res.status).toBe(400);
      expect(res.body.message).toBe(`Incorrect code. ${MAX_ATTEMPTS - i} attempt${MAX_ATTEMPTS - i === 1 ? '' : 's'} remaining`);
    }
    const burned = await confirm(token, 'email', wrong);
    expect(burned.status).toBe(400);
    expect(burned.body.message).toMatch(/too many incorrect attempts/i);

    // The right code no longer works either — the challenge is spent.
    const late = await confirm(token, 'email', code);
    expect(late.status).toBe(400);
    expect(late.body.message).toMatch(/no active code/i);
  });

  it('refuses a malformed code without touching the attempt counter', async () => {
    const { token, userId } = await createGarageWithOwner('verify-shape');
    await send(token, 'email');

    const res = await confirm(token, 'email', '12ab');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Enter the 6-digit code');

    const challenge = await db.query.verificationChallenges.findFirst({ where: eq(schema.verificationChallenges.userId, userId) });
    expect(challenge!.attempts).toBe(0);
  });

  it('refuses an expired code', async () => {
    const { token, userId } = await createGarageWithOwner('verify-expired');
    await send(token, 'email');
    await db.update(schema.verificationChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.verificationChallenges.userId, userId));

    const res = await confirm(token, 'email', lastEmailCode());
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no active code/i);
  });

  it('enforces the resend cooldown, then issues a fresh code that supersedes the old one', async () => {
    const { token, userId } = await createGarageWithOwner('verify-cooldown');
    await send(token, 'email');
    const first = lastEmailCode();

    const tooSoon = await send(token, 'email');
    expect(tooSoon.status).toBe(429);
    expect(emailMock).toHaveBeenCalledTimes(1);

    // Age the first challenge past the cooldown.
    await db.update(schema.verificationChallenges)
      .set({ createdAt: new Date(Date.now() - 2 * 60 * 1000) })
      .where(eq(schema.verificationChallenges.userId, userId));

    const again = await send(token, 'email');
    expect(again.status).toBe(200);
    const second = lastEmailCode();

    if (first !== second) {
      const stale = await confirm(token, 'email', first);
      expect(stale.status).toBe(400);
    }
    const fresh = await confirm(token, 'email', second);
    expect(fresh.status).toBe(200);
  });

  it('caps codes per hour', async () => {
    const { token, userId } = await createGarageWithOwner('verify-hourly');
    for (let i = 0; i < 5; i++) {
      const res = await send(token, 'email');
      expect(res.status).toBe(200);
      await db.update(schema.verificationChallenges)
        .set({ createdAt: new Date(Date.now() - (i + 1) * 5 * 60 * 1000) })
        .where(eq(schema.verificationChallenges.userId, userId));
    }
    const sixth = await send(token, 'email');
    expect(sixth.status).toBe(429);
    expect(sixth.body.message).toMatch(/try again in an hour/i);
  });

  it('is a no-op once verified: send reports already-verified, confirm returns 200', async () => {
    const { token } = await createGarageWithOwner('verify-idempotent');
    await send(token, 'email');
    await confirm(token, 'email', lastEmailCode());
    emailMock.mockClear();

    const sent = await send(token, 'email');
    expect(sent.status).toBe(200);
    expect(sent.body.data.status).toBe('already-verified');
    expect(emailMock).not.toHaveBeenCalled();

    const confirmed = await confirm(token, 'email', '123456');
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.emailVerifiedAt).toBeTruthy();
  });
});

describe('owner verification: phone', () => {
  it('sends the code by SMS to the E.164 number for the garage country and confirms it', async () => {
    const { token, userId } = await createGarageWithOwner('verify-phone');
    const user = await findById(schema.users, userId);

    const sent = await send(token, 'phone');
    expect(sent.status).toBe(200);
    expect(sent.body.data.target).toBe(`****${user!.phone.slice(-4)}`);
    expect(smsMock).toHaveBeenCalledTimes(1);
    // The real utils/phone formatter runs (only smsService's re-export is
    // mocked), so a bare Indian number goes out in E.164 with the garage's
    // country alongside for the transport.
    expect(smsMock.mock.calls[0][0]).toMatchObject({ to: `+91${user!.phone}`, country: 'IN' });
    expect(smsMock.mock.calls[0][0].body).toMatch(/GaragePulse verification code is \d{6}/);

    const confirmed = await confirm(token, 'phone', lastSmsCode());
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.phoneVerifiedAt).toBeTruthy();
    expect(confirmed.body.data.emailVerifiedAt).toBeNull();
  });

  it('clears the phone verification when the number changes, and refuses the old code', async () => {
    const { token } = await createGarageWithOwner('verify-phone-change');
    await send(token, 'phone');
    const code = lastSmsCode();

    const updated = await request(app).put('/api/auth/profile').set(authHeader(token)).send({ phone: nextPhone() });
    expect(updated.status).toBe(200);

    const stale = await confirm(token, 'phone', code);
    expect(stale.status).toBe(400);
    expect(stale.body.message).toMatch(/phone changed since/i);

    // And a number that was verified loses the mark on change.
    await db.update(schema.verificationChallenges).set({ createdAt: new Date(Date.now() - 2 * 60 * 1000) });
    await send(token, 'phone');
    await confirm(token, 'phone', lastSmsCode());
    const before = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(before.body.data.phoneVerifiedAt).toBeTruthy();

    await request(app).put('/api/auth/profile').set(authHeader(token)).send({ phone: nextPhone() });
    const after = await request(app).get('/api/auth/me').set(authHeader(token));
    expect(after.body.data.phoneVerifiedAt).toBeNull();
    // Saving the same number again does not clear it.
    const same = await request(app).put('/api/auth/profile').set(authHeader(token)).send({ name: 'Renamed' });
    expect(same.body.data.phoneVerifiedAt).toBeNull();
  });
});

describe('owner verification: access and delivery', () => {
  it('is owner-only', async () => {
    const { token } = await createGarageWithOwner('verify-staff');
    const staffEmail = 'verify-mech@example.com';
    await request(app).post('/api/users').set(authHeader(token))
      .send({ name: 'Mech', email: staffEmail, phone: nextPhone(), password: 'password123', role: 'mechanic' });
    const login = await request(app).post('/api/auth/login').send({ email: staffEmail, password: 'password123' });
    const staffToken = login.body.token as string;

    expect((await request(app).get('/api/auth/verification').set(authHeader(staffToken))).status).toBe(403);
    expect((await send(staffToken, 'email')).status).toBe(403);
    expect((await confirm(staffToken, 'email', '123456')).status).toBe(403);
  });

  it('rejects an unknown channel', async () => {
    const { token } = await createGarageWithOwner('verify-channel');
    const res = await send(token, 'fax');
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/email, phone/);
  });

  it('carries both flags on login and register payloads', async () => {
    const reg = await registerGarageOwner({ email: 'verify-payload@example.com' });
    expect(reg.body.data).toMatchObject({ emailVerifiedAt: null, phoneVerifiedAt: null });

    const login = await request(app).post('/api/auth/login').send({ email: 'verify-payload@example.com', password: 'password123' });
    expect(login.body.data).toMatchObject({ emailVerifiedAt: null, phoneVerifiedAt: null });
  });

  it('answers 502 without the provider message when the SMS provider rejects the send, and leaves no cooldown behind', async () => {
    // Twilio 21606, verbatim from a real failure: the From number is not
    // usable for this destination (geo permissions, trial account, wrong account).
    const twilioError = Object.assign(
      new Error("'From' +16414496294 is not a Twilio phone number or Short Code country mismatch"),
      { code: 21606, status: 400 }
    );
    smsMock.mockRejectedValueOnce(twilioError);
    const { token, userId } = await createGarageWithOwner('verify-provider-down');

    const failed = await send(token, 'phone');
    expect(failed.status).toBe(502);
    expect(failed.body.message).toBe('We could not send the code by SMS right now. Please try again later');
    expect(JSON.stringify(failed.body)).not.toContain('+16414496294');
    expect(JSON.stringify(failed.body)).not.toContain('Twilio');

    // The failed issue is gone: no cooldown, nothing counted against the hour.
    const rows = await db.query.verificationChallenges.findMany({ where: eq(schema.verificationChallenges.userId, userId) });
    expect(rows).toHaveLength(0);

    const retry = await send(token, 'phone');
    expect(retry.status).toBe(200);
    expect(retry.body.data.status).toBe('sent');
  });

  it('does the same for an email provider failure', async () => {
    emailMock.mockRejectedValueOnce(new Error('Invalid login: 535 Authentication failed'));
    const { token } = await createGarageWithOwner('verify-smtp-down');

    const failed = await send(token, 'email');
    expect(failed.status).toBe(502);
    expect(failed.body.message).toMatch(/could not send the code by email/i);
    expect(failed.body.message).not.toContain('535');

    expect((await send(token, 'email')).status).toBe(200);
  });

  describe('in production', () => {
    const saved = { NODE_ENV: process.env.NODE_ENV, SMTP_HOST: process.env.SMTP_HOST, SMTP_USER: process.env.SMTP_USER };
    beforeEach(() => { process.env.NODE_ENV = 'production'; delete process.env.SMTP_HOST; delete process.env.SMTP_USER; });
    afterEach(() => { Object.assign(process.env, saved); if (!saved.SMTP_HOST) delete process.env.SMTP_HOST; if (!saved.SMTP_USER) delete process.env.SMTP_USER; });

    it('refuses to pretend when email delivery is not configured', async () => {
      const { token } = await createGarageWithOwner('verify-prod-email');
      const res = await send(token, 'email');
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/email delivery is not configured/i);
      expect(emailMock).not.toHaveBeenCalled();
    });

    it('refuses to pretend when SMS delivery is not configured', async () => {
      const { token } = await createGarageWithOwner('verify-prod-sms');
      const res = await send(token, 'phone');
      expect(res.status).toBe(503);
      expect(res.body.message).toMatch(/sms delivery is not configured/i);
      expect(smsMock).not.toHaveBeenCalled();
    });

    it('treats a send the transport only logged as undelivered', async () => {
      // Twilio "configured" but the mocked send reports logged: true.
      smsConfiguredMock.mockReturnValue(true);
      const { token } = await createGarageWithOwner('verify-prod-logged');
      const res = await send(token, 'phone');
      expect(res.status).toBe(503);
    });
  });
});

describe('maskTarget', () => {
  it('keeps enough to recognise, no more', () => {
    expect(maskTarget('email', 'dinson.cd@gmail.com')).toBe('d***d@gmail.com');
    expect(maskTarget('email', 'ab@x.io')).toBe('a@x.io');
    expect(maskTarget('phone', '+91 98765 43210')).toBe('****3210');
  });
});
