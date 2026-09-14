import { z } from 'zod';
import { verificationChallenges } from '../config/schema';
import { VERIFICATION_CHANNELS, VerificationChannel } from '../types/domain';

/**
 * A one-time code an owner must enter to prove they hold an email address or
 * phone number. See `usecases/verificationUsecase.ts` for the flow; the
 * numbers below are the policy.
 */
export { verificationChallenges, VERIFICATION_CHANNELS };
export type { VerificationChannel };
export type VerificationChallengeRow = typeof verificationChallenges.$inferSelect;

/** A code is good for ten minutes from issue. */
export const CODE_TTL_MS = 10 * 60 * 1000;
/** Five wrong guesses burn the code; a new one must be requested. */
export const MAX_ATTEMPTS = 5;
/** The soonest a second code may be requested for the same channel. */
export const RESEND_COOLDOWN_MS = 60 * 1000;
/** Codes per channel per rolling hour — what bounds SMS spend from one account. */
export const MAX_PER_HOUR = 5;
export const CODE_LENGTH = 6;

export const isVerificationChannel = (value: unknown): value is VerificationChannel =>
  typeof value === 'string' && (VERIFICATION_CHANNELS as readonly string[]).includes(value);

export const confirmCodeSchema = z.object({
  code: z.preprocess(
    v => (typeof v === 'number' ? String(v) : typeof v === 'string' ? v.replace(/\s+/g, '') : v),
    z.string({ error: `Enter the ${CODE_LENGTH}-digit code` })
      .regex(new RegExp(`^[0-9]{${CODE_LENGTH}}$`), { error: `Enter the ${CODE_LENGTH}-digit code` })
  )
});
