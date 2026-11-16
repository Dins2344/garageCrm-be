import { z } from 'zod';
import { subscriptions } from '../config/schema';

export { subscriptions };
export type SubscriptionRow = typeof subscriptions.$inferSelect;

export const BILLING_BAD_INPUT = 'Purchase request was not valid.';
export const PURCHASE_NOT_FOUND = 'We could not find this purchase. Try again in a few minutes.';
export const WRONG_ACCOUNT = 'This subscription belongs to another MyGarage account. Sign in with that account to use it.';
export const PLUS_NEEDED = 'Sharing a garage needs MyGarage Plus.';
export const OWNER_PLUS_ENDED = "The garage owner's MyGarage Plus has ended, so no one new can join for now.";
export const REVOKED = 'REVOKED';

export const verifySchema = z.object({ purchaseToken: z.string().min(1).max(1024) });

/** A Pub/Sub push body. Only `message.data` matters: base64 JSON of Play's DeveloperNotification. */
export const pushSchema = z.object({ message: z.object({ data: z.string().max(10000) }) });
export const notificationSchema = z.object({
  packageName: z.string(),
  subscriptionNotification: z.object({ purchaseToken: z.string().min(1).max(1024) }).optional(),
  voidedPurchaseNotification: z.object({ purchaseToken: z.string().min(1).max(1024), productType: z.number().optional() }).optional()
});

/** Play's subscriptionsv2 product type for a voided subscription (2 is a one-time product). */
export const VOIDED_SUBSCRIPTION = 1;
