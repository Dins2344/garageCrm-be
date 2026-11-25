import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { getMyGarageEnv } from '../config/env';
import { garageMembers, plusGrants, sharedGarages, users } from '../config/schema';
import { subscriptions, SubscriptionRow, PLUS_NEEDED, PURCHASE_NOT_FOUND, REVOKED, VOIDED_SUBSCRIPTION, WRONG_ACCOUNT } from '../models/Subscription';
import { acknowledge, getSubscription, PACKAGE, PlaySubscription } from '../services/play';
import { HttpError } from '../../utils/httpError';
import logger from '../../utils/logger';

const log = logger.child('MyGarageBilling');

const ACTIVE = new Set(['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD']);

/**
 * Plus while Play says active or in grace period, or cancelled with paid time left. Account hold, pause, expiry,
 * a pending purchase and a refund give nothing. The phone must not decide this: Play's client API still lists on-hold purchases.
 */
export const grantsPlus = (state: string, expiresAt: Date | null, now = Date.now()): boolean =>
  ACTIVE.has(state) || (state === 'SUBSCRIPTION_STATE_CANCELED' && expiresAt !== null && expiresAt.getTime() > now);

/** `freeUntil` is the end of referral days not applied as a Play deferral. When those days give the latest end, it equals `until`. */
export type Entitlement = { plus: boolean; until: string | null; autoRenew: boolean; adFree: boolean; freeUntil: string | null };

const liveRow = async (userId: string): Promise<SubscriptionRow | undefined> =>
  (await mgDb.select().from(subscriptions).where(eq(subscriptions.userId, userId)))
    .filter((r) => grantsPlus(r.state, r.expiresAt))
    .sort((a, b) => (b.expiresAt?.getTime() ?? 0) - (a.expiresAt?.getTime() ?? 0))[0];

/** The latest expiry across Play's line items, or null when none has one. */
export const expiryOf = (sub: PlaySubscription): Date | null => {
  const expiry = Math.max(...(sub.lineItems ?? []).map((i) => Date.parse(i.expiryTime ?? '')).filter(Number.isFinite));
  return Number.isFinite(expiry) ? new Date(expiry) : null;
};

/**
 * Paid time merged with free grants. A grant counts while `now` is inside it, or when it starts later but
 * follows on from paid time or another counted grant with no gap.
 */
const plusOf = async (userId: string): Promise<{ row: SubscriptionRow | undefined; plus: boolean; until: Date | null; freeUntil: Date | null }> => {
  const now = new Date();
  const row = await liveRow(userId);
  const grants = await mgDb.select().from(plusGrants)
    .where(and(eq(plusGrants.userId, userId), gt(plusGrants.endsAt, now))).orderBy(asc(plusGrants.startsAt));
  let reach = row?.expiresAt && row.expiresAt > now ? row.expiresAt : now; // covered without a gap up to here
  let until = row?.expiresAt ?? null;
  let inGrant = false;
  for (const g of grants) {
    // A deferral extends the live subscription itself, even before Play's notification updates our copy of its expiry.
    if (g.startsAt > reach && !(g.deferredToken !== null && row)) continue;
    if (g.startsAt <= now) inGrant = true;
    if (g.endsAt > reach) reach = g.endsAt;
    if (!until || g.endsAt > until) until = g.endsAt;
  }
  const free = grants.filter((g) => g.deferredToken === null).map((g) => g.endsAt);
  const freeUntil = free.length ? free.reduce((a, b) => (b > a ? b : a)) : null;
  return { row, plus: row !== undefined || inGrant, until, freeUntil };
};

export const isPlus = async (userId: string): Promise<boolean> => (await plusOf(userId)).plus;

/** Sharing is the owner's to pay for: everyone in a Plus owner's garage gets no ads. */
const inPlusGarage = async (userId: string): Promise<boolean> => {
  const owners = await mgDb.selectDistinct({ id: sharedGarages.ownerId })
    .from(garageMembers).innerJoin(sharedGarages, eq(sharedGarages.id, garageMembers.garageId))
    .where(and(eq(garageMembers.userId, userId), ne(garageMembers.role, 'owner')));
  for (const { id } of owners) if (await isPlus(id)) return true;
  return false;
};

export const entitlementOf = async ({ userId }: { userId: string }): Promise<Entitlement> => {
  const { row, plus, until, freeUntil } = await plusOf(userId);
  return {
    plus,
    until: until?.toISOString() ?? null,
    autoRenew: row?.autoRenew ?? false,
    adFree: plus || (await inPlusGarage(userId)),
    freeUntil: freeUntil?.toISOString() ?? null
  };
};

/** Throws 402 when sharing needs Plus and this user has none. A no-op until MYGARAGE_REQUIRE_PLUS is on. */
export const requirePlus = async (userId: string, message = PLUS_NEEDED): Promise<void> => {
  if (getMyGarageEnv().requirePlus && !(await isPlus(userId))) throw new HttpError(message, 402);
};

const userExists = async (id: string): Promise<boolean> =>
  (await mgDb.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1)).length > 0;

const ownerOf = async (purchaseToken: string): Promise<string | null> =>
  (await mgDb.select({ userId: subscriptions.userId }).from(subscriptions).where(eq(subscriptions.purchaseToken, purchaseToken)))[0]?.userId ?? null;

/** The account a purchase belongs to: the one it was stored under, else the one the app named when buying, if that account still exists. */
const claimedBy = async (purchaseToken: string, sub: PlaySubscription): Promise<string | null> => {
  const stored = await ownerOf(purchaseToken);
  if (stored) return stored;
  const named = sub.externalAccountIdentifiers?.obfuscatedExternalAccountId;
  return named && (await userExists(named)) ? named : null;
};

/** Copies Play's answer into our row. A refunded token stays revoked whatever Play says later. An upgrade or resubscribe ends the token it replaced. */
const save = async (purchaseToken: string, userId: string, sub: PlaySubscription): Promise<SubscriptionRow> => {
  const items = sub.lineItems ?? [];
  const values = {
    productId: items[0]?.productId ?? '',
    basePlanId: items[0]?.offerDetails?.basePlanId ?? null,
    state: sub.subscriptionState ?? 'SUBSCRIPTION_STATE_UNSPECIFIED',
    expiresAt: expiryOf(sub),
    autoRenew: items.some((i) => i.autoRenewingPlan?.autoRenewEnabled === true),
    updatedAt: new Date()
  };
  return mgDb.transaction(async (tx) => {
    await tx.insert(subscriptions).values({ purchaseToken, userId, ...values })
      .onConflictDoUpdate({ target: subscriptions.purchaseToken, set: values, setWhere: sql`${subscriptions.state} <> ${REVOKED}` });
    if (sub.linkedPurchaseToken && sub.linkedPurchaseToken !== purchaseToken) {
      await tx.delete(subscriptions).where(eq(subscriptions.purchaseToken, sub.linkedPurchaseToken));
    }
    const [row] = await tx.select().from(subscriptions).where(eq(subscriptions.purchaseToken, purchaseToken));
    return row;
  });
};

const ackIfPending = async (row: SubscriptionRow, sub: PlaySubscription): Promise<void> => {
  if (sub.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_PENDING' || !grantsPlus(row.state, row.expiresAt)) return;
  await acknowledge(row.productId, row.purchaseToken);
  log.info('Purchase acknowledged', { userId: row.userId });
};

/** Called by the app right after a purchase and by Restore purchases. */
export const verifyPurchase = async ({ userId, purchaseToken }: { userId: string; purchaseToken: string }): Promise<Entitlement> => {
  const sub = await getSubscription(purchaseToken);
  if (!sub?.lineItems?.length) throw new HttpError(PURCHASE_NOT_FOUND, 404);
  const owner = await claimedBy(purchaseToken, sub);
  if (owner && owner !== userId) throw new HttpError(WRONG_ACCOUNT, 409);
  const row = await save(purchaseToken, userId, sub);
  // Play's notification for this purchase acknowledges it too, so a failure here only waits for that.
  await ackIfPending(row, sub).catch((e: unknown) => log.warn('Acknowledge failed; the notification will retry', { userId, errorName: (e as Error)?.name }));
  log.info('Purchase verified', { userId, state: row.state });
  return entitlementOf({ userId });
};

/**
 * One Real-time Developer Notification. Each only says something changed, so Play is asked again; repeats are harmless.
 * Throws on a Play failure so Pub/Sub retries; returns quietly for anything that is not ours or cannot be used.
 */
export const handleNotification = async (n: {
  packageName: string;
  subscriptionNotification?: { purchaseToken: string };
  voidedPurchaseNotification?: { purchaseToken: string; productType?: number };
}): Promise<void> => {
  if (n.packageName !== PACKAGE) return;
  const voided = n.voidedPurchaseNotification;
  if (voided) {
    if (voided.productType !== undefined && voided.productType !== VOIDED_SUBSCRIPTION) return;
    await mgDb.update(subscriptions).set({ state: REVOKED, expiresAt: new Date(), autoRenew: false, updatedAt: new Date() })
      .where(eq(subscriptions.purchaseToken, voided.purchaseToken));
    log.info('Purchase refunded or charged back; Plus revoked');
    return;
  }
  const purchaseToken = n.subscriptionNotification?.purchaseToken;
  if (!purchaseToken) return; // a test notification or a one-time product
  const sub = await getSubscription(purchaseToken);
  if (!sub?.lineItems?.length) return;
  const userId = await claimedBy(purchaseToken, sub);
  if (!userId) {
    log.info('Notification for a purchase with no MyGarage account');
    return;
  }
  const row = await save(purchaseToken, userId, sub);
  await ackIfPending(row, sub);
};
