import crypto from 'crypto';
import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';
import { db } from '../config/db';
import { users, USER_PUBLIC_COLUMNS, userToApi } from '../models/User';
import {
  verificationChallenges, VerificationChannel, VerificationChallengeRow,
  CODE_TTL_MS, MAX_ATTEMPTS, RESEND_COOLDOWN_MS, MAX_PER_HOUR, CODE_LENGTH, confirmCodeSchema
} from '../models/VerificationChallenge';
import { sendVerificationEmail } from '../services/emailService';
import { sendSms, isSmsConfigured } from '../services/smsService';
import { formatPhoneE164 } from '../utils/phone';
import { runSchema } from '../utils/validation';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('VerificationUsecase');

/**
 * OWNER EMAIL / PHONE VERIFICATION
 *
 * An owner proves they hold an address by entering a six-digit code sent to
 * it. The code is stored hashed, lives ten minutes, burns after five wrong
 * guesses, and is tied to the address it was sent to. Success stamps
 * `users.<channel>VerifiedAt`, which is what the subscription gate will read.
 *
 * Delivery is the one thing this cannot fake. `sendEmail` falls back to an
 * Ethereal test inbox when SMTP is unset and `sendSms` merely logs when
 * Twilio is unset — fine for development, but an owner in production would
 * wait for a code that never arrives. So in production, unconfigured
 * delivery is refused up front with a 503.
 */

const hashCode = (code: string): string => crypto.createHash('sha256').update(code).digest('hex');

const newCode = (): string => String(crypto.randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** Real SMTP, not the Ethereal fallback `initTransport` silently uses. */
const emailDeliveryConfigured = (): boolean => !!(process.env.SMTP_HOST && process.env.SMTP_USER);

/** `d***n@example.com` / `****3210` — enough for the owner to recognise, no more. */
export const maskTarget = (channel: VerificationChannel, value: string): string => {
  if (channel === 'email') {
    const [local, domain] = value.split('@');
    if (!domain) return value;
    const shown = local.length <= 2 ? local[0] ?? '' : `${local[0]}***${local[local.length - 1]}`;
    return `${shown}@${domain}`;
  }
  const digits = value.replace(/\D/g, '');
  return `****${digits.slice(-4)}`;
};

const currentTarget = (channel: VerificationChannel, user: { email: string; phone: string }): string =>
  channel === 'email' ? user.email : user.phone;

const latestChallenge = async (userId: string, channel: VerificationChannel): Promise<VerificationChallengeRow | undefined> =>
  db.query.verificationChallenges.findFirst({
    where: and(
      eq(verificationChallenges.userId, userId),
      eq(verificationChallenges.channel, channel),
      isNull(verificationChallenges.consumedAt)
    ),
    orderBy: [desc(verificationChallenges.createdAt)]
  });

interface SendInput {
  userId: string;
  channel: VerificationChannel;
}

export interface SendResult {
  status: 'sent' | 'already-verified';
  channel: VerificationChannel;
  target: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

export const sendVerificationCode = async ({ userId, channel }: SendInput): Promise<SendResult> => {
  const user = await db.query.users.findFirst({
    columns: { _id: true, name: true, email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
    where: eq(users._id, userId),
    with: { garage: { columns: { country: true } } }
  });
  if (!user) {
    throw new HttpError('User not found', 404);
  }

  const target = currentTarget(channel, user);
  const masked = maskTarget(channel, target);
  const result = (status: SendResult['status']): SendResult => ({
    status, channel, target: masked,
    expiresInSeconds: CODE_TTL_MS / 1000,
    resendAfterSeconds: RESEND_COOLDOWN_MS / 1000
  });

  if (channel === 'email' ? user.emailVerifiedAt : user.phoneVerifiedAt) {
    return result('already-verified');
  }

  // Per-user throttles. The route also carries an IP limiter; this is what
  // stops one account from burning the SMS budget.
  const latest = await latestChallenge(userId, channel);
  if (latest && Date.now() - latest.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new HttpError('Please wait a minute before requesting another code', 429);
  }
  const [{ issuedLastHour }] = await db.select({ issuedLastHour: count() }).from(verificationChallenges).where(and(
    eq(verificationChallenges.userId, userId),
    eq(verificationChallenges.channel, channel),
    gt(verificationChallenges.createdAt, new Date(Date.now() - 60 * 60 * 1000))
  ));
  if (issuedLastHour >= MAX_PER_HOUR) {
    throw new HttpError('Too many codes requested. Please try again in an hour', 429);
  }

  // Refuse before issuing anything a real user could not receive.
  let phoneE164 = '';
  if (channel === 'email') {
    if (isProduction() && !emailDeliveryConfigured()) {
      throw new HttpError('Email delivery is not configured on this server', 503);
    }
  } else {
    if (isProduction() && !isSmsConfigured()) {
      throw new HttpError('SMS delivery is not configured on this server', 503);
    }
    phoneE164 = formatPhoneE164(user.phone, user.garage.country);
    if (!phoneE164) {
      throw new HttpError('Your phone number could not be validated. Update it in your profile first', 400);
    }
  }

  const code = newCode();
  const challenge = await db.transaction(async tx => {
    // Only the newest code is live: supersede anything still open.
    await tx.update(verificationChallenges).set({ consumedAt: new Date() }).where(and(
      eq(verificationChallenges.userId, userId),
      eq(verificationChallenges.channel, channel),
      isNull(verificationChallenges.consumedAt)
    ));
    const [row] = await tx.insert(verificationChallenges).values({
      userId,
      channel,
      target,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS)
    }).returning({ _id: verificationChallenges._id });
    return row;
  });

  // A send the provider rejected must not count: the row is removed outright
  // so neither the resend cooldown nor the hourly cap holds the owner to a
  // code that never left the building.
  const undoIssue = () => db.delete(verificationChallenges).where(eq(verificationChallenges._id, challenge._id));

  let delivery: { logged: boolean };
  try {
    delivery = channel === 'email'
      ? await sendVerificationEmail({ to: user.email, name: user.name, code, expiresInMinutes: CODE_TTL_MS / 60000 })
      : await sendSms({
          to: phoneE164,
          body: `Your GaragePulse verification code is ${code}. It expires in ${CODE_TTL_MS / 60000} minutes.`,
          country: user.garage.country
        });
  } catch (err) {
    await undoIssue();
    // The provider's message names our sending number and its account
    // configuration (a Twilio 21606 reads "'From' +1... is not a Twilio phone
    // number"). That belongs in the log, never in a client response.
    const provider = err as Error & { code?: string | number; status?: number };
    log.error('Verification code delivery failed at the provider', {
      userId, channel, providerCode: provider.code, providerStatus: provider.status, error: provider.message
    });
    throw new HttpError(
      `We could not send the code by ${channel === 'email' ? 'email' : 'SMS'} right now. Please try again later`,
      502
    );
  }

  if (delivery.logged) {
    if (isProduction()) {
      await undoIssue();
      throw new HttpError(`${channel === 'email' ? 'Email' : 'SMS'} delivery is not configured on this server`, 503);
    }
    // Development and test only — this is how the flow is completed locally.
    log.info('Verification code not delivered (no transport) — logging it for local use', { userId, channel, code });
  }

  log.info('Verification code sent', { userId, channel, target: masked });
  return result('sent');
};

interface ConfirmInput {
  userId: string;
  channel: VerificationChannel;
  code: unknown;
}

export const confirmVerificationCode = async ({ userId, channel, code }: ConfirmInput): Promise<ApiObject> => {
  const { code: entered } = runSchema(confirmCodeSchema, { code });

  const user = await db.query.users.findFirst({ columns: USER_PUBLIC_COLUMNS, where: eq(users._id, userId) });
  if (!user) {
    throw new HttpError('User not found', 404);
  }

  // Idempotent: a second confirm (two tabs, a retry) is not an error.
  if (channel === 'email' ? user.emailVerifiedAt : user.phoneVerifiedAt) {
    return userToApi(user);
  }

  const challenge = await latestChallenge(userId, channel);
  if (!challenge || challenge.expiresAt.getTime() < Date.now()) {
    throw new HttpError('No active code. Request a new one', 400);
  }

  if (challenge.attempts >= MAX_ATTEMPTS) {
    await db.update(verificationChallenges).set({ consumedAt: new Date() }).where(eq(verificationChallenges._id, challenge._id));
    throw new HttpError('Too many incorrect attempts. Request a new code', 400);
  }

  if (challenge.target !== currentTarget(channel, user)) {
    await db.update(verificationChallenges).set({ consumedAt: new Date() }).where(eq(verificationChallenges._id, challenge._id));
    throw new HttpError(`Your ${channel} changed since this code was sent. Request a new one`, 400);
  }

  const expected = Buffer.from(challenge.codeHash, 'hex');
  const actual = Buffer.from(hashCode(entered), 'hex');
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    const attempts = challenge.attempts + 1;
    const remaining = MAX_ATTEMPTS - attempts;
    await db.update(verificationChallenges).set({
      attempts,
      ...(remaining <= 0 ? { consumedAt: new Date() } : {})
    }).where(eq(verificationChallenges._id, challenge._id));
    log.warn('Incorrect verification code', { userId, channel, attempts });
    throw new HttpError(
      remaining > 0
        ? `Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining`
        : 'Too many incorrect attempts. Request a new code',
      400
    );
  }

  const verified = await db.transaction(async tx => {
    await tx.update(verificationChallenges).set({ consumedAt: new Date() }).where(eq(verificationChallenges._id, challenge._id));
    const [row] = await tx.update(users).set({ [channel === 'email' ? 'emailVerifiedAt' : 'phoneVerifiedAt']: new Date() })
      .where(eq(users._id, userId)).returning();
    return row;
  });

  log.info('Verification confirmed', { userId, channel });
  return userToApi(verified);
};

interface StatusInput {
  userId: string;
}

export interface VerificationStatus {
  email: { value: string; verifiedAt: Date | null };
  phone: { value: string; verifiedAt: Date | null };
}

export const getVerificationStatus = async ({ userId }: StatusInput): Promise<VerificationStatus> => {
  const user = await db.query.users.findFirst({
    columns: { email: true, phone: true, emailVerifiedAt: true, phoneVerifiedAt: true },
    where: eq(users._id, userId)
  });
  if (!user) {
    throw new HttpError('User not found', 404);
  }
  return {
    email: { value: user.email, verifiedAt: user.emailVerifiedAt },
    phone: { value: user.phone, verifiedAt: user.phoneVerifiedAt }
  };
};
