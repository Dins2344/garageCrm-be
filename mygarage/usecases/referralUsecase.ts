import { randomInt } from 'crypto';
import { and, count, desc, eq, gte, isNull, ne, or, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { getMyGarageEnv } from '../config/env';
import { deletedGoogleAccounts, plusGrants, referralCodes, referrals, subscriptions, users } from '../config/schema';
import { REDEEM_WINDOW_MS, REFERRAL_CODE_RE, REWARD_DAYS, RedeemResult, WITHDRAW_WINDOW_MS, YEARLY_CAP } from '../models/Referral';
import { hashToken } from '../services/crypto';
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

/** No referral as friend yet, the account is at most 7 days old, and its Google account has never deleted an account here. */
const canRedeem = async (userId: string): Promise<boolean> => {
  const [user] = await mgDb.select({ createdAt: users.createdAt, googleSub: users.googleSub }).from(users).where(eq(users.id, userId));
  if (!user || user.createdAt.getTime() < Date.now() - REDEEM_WINDOW_MS) return false;
  const [used] = await mgDb.select({ id: referrals.id }).from(referrals).where(eq(referrals.refereeId, userId)).limit(1);
  const [deleted] = await mgDb.select({ subHash: deletedGoogleAccounts.subHash }).from(deletedGoogleAccounts)
    .where(eq(deletedGoogleAccounts.subHash, hashToken(user.googleSub))).limit(1);
  return used === undefined && deleted === undefined;
};

/** Grants this user earned as a referrer (join `referrals` on `referralId`). Their own reward as a friend does not count. */
const earnedAsReferrer = (userId: string) => and(
  eq(plusGrants.userId, userId), eq(plusGrants.reason, 'referral'), or(isNull(referrals.refereeId), ne(referrals.refereeId, userId))
);

/**
 * Referral grants this user earned as a referrer this calendar year (UTC). Their own reward as a friend does not count.
 * A grant whose friend deleted their account has lost its referral, and still counts.
 */
const referrerGrantsThisYear = async (db: Tx | typeof mgDb, userId: string): Promise<number> => {
  const yearStart = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  const [{ n }] = await db.select({ n: count() }).from(plusGrants)
    .leftJoin(referrals, eq(referrals.id, plusGrants.referralId))
    .where(and(earnedAsReferrer(userId), gte(plusGrants.createdAt, yearStart)));
  return n;
};

export type ReferralStatus = { enabled: false } | {
  enabled: true; code: string; link: string; joined: number; rewarded: number; daysEarned: number; capLeft: number; canRedeem: boolean;
};

export const status = async (userId: string): Promise<ReferralStatus> => {
  if (!getMyGarageEnv().referrals) return { enabled: false };
  const code = await codeFor(userId);
  const [{ live }] = await mgDb.select({ live: count() }).from(referrals).where(eq(referrals.referrerId, userId));
  // Counted from the grants, which outlive a friend who deletes their account; such a grant has lost its referral.
  const [{ rewarded, linked }] = await mgDb.select({ rewarded: count(), linked: count(plusGrants.referralId) }).from(plusGrants)
    .leftJoin(referrals, eq(referrals.id, plusGrants.referralId)).where(earnedAsReferrer(userId));
  const joined = live + rewarded - linked;
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

/** Stacks the days after the user's paid time and earlier grants. Returns the grant's id. */
export const grantDays = async (tx: Tx, userId: string, days: number, referralId: string): Promise<string> => {
  const rows = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId));
  const [last] = await tx.select({ endsAt: plusGrants.endsAt }).from(plusGrants).where(eq(plusGrants.userId, userId)).orderBy(desc(plusGrants.endsAt)).limit(1);
  const paid = rows.filter((r) => grantsPlus(r.state, r.expiresAt)).map((r) => r.expiresAt?.getTime() ?? 0);
  const startsAt = new Date(Math.max(Date.now(), ...paid, last?.endsAt.getTime() ?? 0));
  const [grant] = await tx.insert(plusGrants).values({ userId, reason: 'referral', days, referralId, startsAt, endsAt: new Date(startsAt.getTime() + days * DAY) })
    .returning({ id: plusGrants.id });
  log.info('Plus days granted', { userId, days });
  return grant.id;
};

/**
 * Runs after the reward is committed, so a retry can never defer twice. For an auto-renewing subscriber, Play
 * pushes the next charge back and the stacked grant becomes that deferral. Any failure, or a crash before this
 * runs, leaves the stacked grant: the days are never lost. Never throws.
 */
const deferIfRenewing = async (userId: string, grantId: string, days: number): Promise<void> => {
  let deferred: { token: string; from: Date } | null = null;
  try {
    const [renewing] = await mgDb.select().from(subscriptions)
      .where(and(eq(subscriptions.userId, userId), eq(subscriptions.state, 'SUBSCRIPTION_STATE_ACTIVE'), eq(subscriptions.autoRenew, true)))
      .orderBy(desc(subscriptions.expiresAt)).limit(1);
    if (!renewing) return;
    const sub = await getSubscription(renewing.purchaseToken);
    const from = sub ? expiryOf(sub) : null;
    if (!sub?.etag || !from) throw new Error('Play gave no etag or expiry');
    await deferSubscription(renewing.purchaseToken, sub.etag, days);
    deferred = { token: renewing.purchaseToken, from };
  } catch (e) {
    log.warn('Deferral failed; the days stay stacked', { userId, errorName: (e as Error)?.name });
    return;
  }
  try {
    await mgDb.update(plusGrants)
      .set({ deferredToken: deferred.token, startsAt: deferred.from, endsAt: new Date(deferred.from.getTime() + days * DAY) })
      .where(eq(plusGrants.id, grantId));
    log.info('Plus days deferred the next charge', { userId, days });
  } catch (e) {
    // Play has deferred, but the grant still reads as stacked days: the user gets both. Rare, and in their favour.
    log.error('Deferral made but the grant was not updated', { userId, errorName: (e as Error)?.name });
  }
};

/**
 * Part of account deletion, before the user row goes. A friend who leaves within 5 days of the reward takes the
 * referrer's days with them, and the referrer's later stacked days move up so no gap is left. Their own days go with
 * their account anyway.
 */
export const withdrawOnDelete = async (tx: Tx, userId: string): Promise<void> => {
  const [ref] = await tx.select({ id: referrals.id, referrerId: referrals.referrerId }).from(referrals).where(and(
    eq(referrals.refereeId, userId), eq(referrals.status, 'rewarded'), gte(referrals.rewardedAt, new Date(Date.now() - WITHDRAW_WINDOW_MS))
  ));
  if (!ref?.referrerId) return;
  await tx.select({ id: users.id }).from(users).where(eq(users.id, ref.referrerId)).for('no key update'); // against a reward landing at once
  // ponytail: days already applied as a Play deferral stay with the referrer; Play cannot bring a charge forward.
  const [gone] = await tx.delete(plusGrants)
    .where(and(eq(plusGrants.referralId, ref.id), eq(plusGrants.userId, ref.referrerId), isNull(plusGrants.deferredToken))).returning();
  if (!gone) return;
  await tx.update(plusGrants).set({
    startsAt: sql`${plusGrants.startsAt} - make_interval(days => ${gone.days}::int)`,
    endsAt: sql`${plusGrants.endsAt} - make_interval(days => ${gone.days}::int)`
  }).where(and(eq(plusGrants.userId, ref.referrerId), isNull(plusGrants.deferredToken), gte(plusGrants.startsAt, gone.endsAt)));
  log.info('Referral days withdrawn', { userId, referrerId: ref.referrerId });
};

/**
 * Pays a pending referral once. The update to `rewarded` is the guard, so a second or racing call finds nothing.
 * Both grants commit as stacked days first; Play deferrals follow outside the transaction.
 */
export const activate = async (userId: string): Promise<{ result: 'rewarded' | 'none' }> => {
  if (!getMyGarageEnv().referrals) return { result: 'none' };
  const paid = await mgDb.transaction(async (tx) => {
    const [ref] = await tx.update(referrals).set({ status: 'rewarded', rewardedAt: new Date() })
      .where(and(eq(referrals.refereeId, userId), eq(referrals.status, 'pending'))).returning();
    if (!ref) return null;
    const grants = [{ userId, grantId: await grantDays(tx, userId, REWARD_DAYS, ref.id) }];
    if (ref.referrerId) {
      // Locks the referrer, so two friends rewarded at once cannot both take the last place under the cap.
      const [referrer] = await tx.select({ id: users.id }).from(users).where(eq(users.id, ref.referrerId)).for('no key update');
      if (referrer && (await referrerGrantsThisYear(tx, referrer.id)) < YEARLY_CAP) {
        grants.push({ userId: referrer.id, grantId: await grantDays(tx, referrer.id, REWARD_DAYS, ref.id) });
      } else if (referrer) {
        await tx.update(referrals).set({ referrerCapped: true }).where(eq(referrals.id, ref.id));
      }
    }
    log.info('Referral rewarded', { userId, referrerId: ref.referrerId });
    return grants;
  });
  if (!paid) return { result: 'none' };
  for (const g of paid) await deferIfRenewing(g.userId, g.grantId, REWARD_DAYS);
  return { result: 'rewarded' };
};
