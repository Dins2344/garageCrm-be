import { randomInt } from 'crypto';
import { and, count, desc, eq, gte, isNull, ne, or } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { getMyGarageEnv } from '../config/env';
import { plusGrants, referralCodes, referrals, subscriptions, users } from '../config/schema';
import { REDEEM_WINDOW_MS, REFERRAL_CODE_RE, REWARD_DAYS, RedeemResult, YEARLY_CAP } from '../models/Referral';
import { deferSubscription, getSubscription, PACKAGE } from '../services/play';
import { expiryOf, grantsPlus } from './billingUsecase';
import { HttpError } from '../../utils/httpError';
import logger from '../../utils/logger';

const log = logger.child('MyGarageReferral');

const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const DAY = 24 * 60 * 60 * 1000;
export const REFERRALS_OFF = 'Invite codes are not available right now.';

type Tx = Parameters<Parameters<typeof mgDb.transaction>[0]>[0];

const newCode = (): string => `MG-${Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')}`;

/** This account's code, made on first call. A clash with another account's code just tries a new one. */
export const codeFor = async (userId: string): Promise<string> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [row] = await mgDb.select({ code: referralCodes.code }).from(referralCodes).where(eq(referralCodes.userId, userId));
    if (row) return row.code;
    await mgDb.insert(referralCodes).values({ userId, code: newCode() }).onConflictDoNothing();
  }
  throw new Error('No free referral code');
};

/** No referral as friend yet, and the account is at most 7 days old. */
const canRedeem = async (userId: string): Promise<boolean> => {
  const [user] = await mgDb.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  const [used] = await mgDb.select({ id: referrals.id }).from(referrals).where(eq(referrals.refereeId, userId)).limit(1);
  return user !== undefined && used === undefined && user.createdAt.getTime() >= Date.now() - REDEEM_WINDOW_MS;
};

/**
 * Referral grants this user earned as a referrer this calendar year (UTC). Their own reward as a friend does not count.
 * A grant whose friend deleted their account has lost its referral, and still counts.
 */
const referrerGrantsThisYear = async (db: Tx | typeof mgDb, userId: string): Promise<number> => {
  const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const [{ n }] = await db.select({ n: count() }).from(plusGrants)
    .leftJoin(referrals, eq(referrals.id, plusGrants.referralId))
    .where(and(
      eq(plusGrants.userId, userId), eq(plusGrants.reason, 'referral'), gte(plusGrants.createdAt, yearStart),
      or(isNull(referrals.refereeId), ne(referrals.refereeId, userId))
    ));
  return n;
};

export type ReferralStatus = { enabled: false } | {
  enabled: true; code: string; link: string; joined: number; rewarded: number; daysEarned: number; capLeft: number; canRedeem: boolean;
};

export const status = async (userId: string): Promise<ReferralStatus> => {
  if (!getMyGarageEnv().referrals) return { enabled: false };
  const code = await codeFor(userId);
  const [{ joined }] = await mgDb.select({ joined: count() }).from(referrals).where(eq(referrals.referrerId, userId));
  const [{ rewarded }] = await mgDb.select({ rewarded: count() }).from(referrals)
    .where(and(eq(referrals.referrerId, userId), eq(referrals.status, 'rewarded'), eq(referrals.referrerCapped, false)));
  return {
    enabled: true,
    code,
    link: `https://play.google.com/store/apps/details?id=${PACKAGE}&referrer=${code}`,
    joined,
    rewarded,
    daysEarned: rewarded * REWARD_DAYS,
    capLeft: Math.max(0, YEARLY_CAP - (await referrerGrantsThisYear(mgDb, userId))),
    canRedeem: await canRedeem(userId)
  };
};

/** Records the friend's referral. Never rewards: the app calls activate once a vehicle exists. */
export const redeem = async ({ userId, code, source }: { userId: string; code: string; source: 'play' | 'typed' }): Promise<{ result: RedeemResult }> => {
  if (!getMyGarageEnv().referrals) throw new HttpError(REFERRALS_OFF, 404);
  const wanted = code.trim().toUpperCase();
  if (!REFERRAL_CODE_RE.test(wanted)) return { result: 'invalid' };
  const [owner] = await mgDb.select({ userId: referralCodes.userId }).from(referralCodes).where(eq(referralCodes.code, wanted));
  if (!owner) return { result: 'invalid' };
  if (owner.userId === userId) return { result: 'own_code' };
  if (!(await canRedeem(userId))) return { result: 'not_eligible' };
  const added = await mgDb.insert(referrals).values({ referrerId: owner.userId, refereeId: userId, source, status: 'pending' })
    .onConflictDoNothing({ target: referrals.refereeId }).returning({ id: referrals.id });
  if (!added.length) return { result: 'not_eligible' }; // a second redeem won the race
  log.info('Referral redeemed', { userId, referrerId: owner.userId, source });
  return { result: 'pending' };
};

/**
 * Plus days for one user. An auto-renewing subscriber's next charge is deferred; anyone else, or a subscriber
 * whose deferral fails, gets the days after their paid time and earlier grants.
 */
export const grantDays = async (tx: Tx, userId: string, days: number, referralId: string): Promise<void> => {
  const now = new Date();
  const rows = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.expiresAt));
  const renewing = rows.find((r) => r.state === 'SUBSCRIPTION_STATE_ACTIVE' && r.autoRenew);
  if (renewing) {
    let from: Date | null = null;
    try {
      const sub = await getSubscription(renewing.purchaseToken);
      from = sub ? expiryOf(sub) : null;
      if (!sub?.etag || !from) throw new Error('Play gave no etag or expiry');
      await deferSubscription(renewing.purchaseToken, sub.etag, days);
    } catch (e) {
      from = null;
      log.warn('Deferral failed; stacking the days instead', { userId, errorName: (e as Error)?.name });
    }
    if (from) {
      await tx.insert(plusGrants).values({
        userId, reason: 'referral', days, referralId, deferredToken: renewing.purchaseToken, startsAt: from, endsAt: new Date(from.getTime() + days * DAY)
      });
      log.info('Plus days deferred the next charge', { userId, days });
      return;
    }
  }
  const [last] = await tx.select({ endsAt: plusGrants.endsAt }).from(plusGrants).where(eq(plusGrants.userId, userId)).orderBy(desc(plusGrants.endsAt)).limit(1);
  const paid = rows.filter((r) => grantsPlus(r.state, r.expiresAt)).map((r) => r.expiresAt?.getTime() ?? 0);
  const startsAt = new Date(Math.max(now.getTime(), ...paid, last?.endsAt.getTime() ?? 0));
  await tx.insert(plusGrants).values({ userId, reason: 'referral', days, referralId, startsAt, endsAt: new Date(startsAt.getTime() + days * DAY) });
  log.info('Plus days granted', { userId, days });
};

/** Pays a pending referral once: the update to `rewarded` is the guard, so a second or racing call finds nothing. */
export const activate = async (userId: string): Promise<{ result: 'rewarded' | 'none' }> => {
  if (!getMyGarageEnv().referrals) return { result: 'none' };
  return mgDb.transaction(async (tx) => {
    const [ref] = await tx.update(referrals).set({ status: 'rewarded', rewardedAt: new Date() })
      .where(and(eq(referrals.refereeId, userId), eq(referrals.status, 'pending'))).returning();
    if (!ref) return { result: 'none' as const };
    await grantDays(tx, userId, REWARD_DAYS, ref.id);
    if (ref.referrerId) {
      // Locks the referrer, so two friends rewarded at once cannot both take the last place under the cap.
      const [referrer] = await tx.select({ id: users.id }).from(users).where(eq(users.id, ref.referrerId)).for('no key update');
      if (referrer && (await referrerGrantsThisYear(tx, referrer.id)) < YEARLY_CAP) {
        await grantDays(tx, referrer.id, REWARD_DAYS, ref.id);
      } else if (referrer) {
        await tx.update(referrals).set({ referrerCapped: true }).where(eq(referrals.id, ref.id));
      }
    }
    log.info('Referral rewarded', { userId, referrerId: ref.referrerId });
    return { result: 'rewarded' as const };
  });
};
