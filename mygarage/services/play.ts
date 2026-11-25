import { JWT, OAuth2Client } from 'google-auth-library';
import { getMyGarageEnv } from '../config/env';
import { HttpError } from '../../utils/httpError';

export const PACKAGE = 'com.dctechs.mygarage';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases`;
const PLAY_TIMEOUT_MS = 10_000;
export const PURCHASES_OFF = 'Purchases are unavailable right now. Try again later.';

/** The parts of Play's SubscriptionPurchaseV2 we read. */
export type PlaySubscription = {
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  etag?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: { productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean }; offerDetails?: { basePlanId?: string } }[];
};

let client: { email: string; jwt: JWT } | null = null;
const play = (): JWT => {
  const settings = getMyGarageEnv().play;
  if (!settings) throw new HttpError(PURCHASES_OFF, 503);
  if (client?.email !== settings.email) {
    // The timeout covers every Play request and the token fetch; gaxios has none by default.
    client = { email: settings.email, jwt: new JWT({ email: settings.email, key: settings.key, scopes: ['https://www.googleapis.com/auth/androidpublisher'], transporterOptions: { timeout: PLAY_TIMEOUT_MS } }) };
  }
  return client.jwt;
};

const statusOf = (e: unknown): number | undefined => (e as { response?: { status?: number } } | null)?.response?.status;

/** Play's current answer for a token, or null when Play does not know it. Other failures throw, so the caller retries. */
export const getSubscription = async (purchaseToken: string): Promise<PlaySubscription | null> => {
  try {
    return (await play().request<PlaySubscription>({ url: `${API}/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}` })).data;
  } catch (e) {
    if ([400, 404, 410].includes(statusOf(e) ?? 0)) return null;
    throw e;
  }
};

/** Unacknowledged purchases are refunded after three days. */
export const acknowledge = async (productId: string, purchaseToken: string): Promise<void> => {
  await play().request({
    url: `${API}/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`,
    method: 'POST',
    data: {}
  });
};

/** Pushes the next renewal back by whole days. Play refuses an etag older than its latest answer. */
export const deferSubscription = async (purchaseToken: string, etag: string, days: number): Promise<void> => {
  await play().request({
    url: `${API}/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}:defer`,
    method: 'POST',
    data: { deferralContext: { etag, deferDuration: `${days * 86400}s` } }
  });
};

const oidc = new OAuth2Client();

/** True when the request carries the OIDC token our Pub/Sub push subscription signs with. */
export const isPlayPush = async (authorization: string | undefined): Promise<boolean> => {
  const settings = getMyGarageEnv().play;
  if (!settings) throw new HttpError(PURCHASES_OFF, 503); // Pub/Sub keeps it and retries once purchases are set up
  if (!authorization?.startsWith('Bearer ')) return false;
  try {
    const ticket = await oidc.verifyIdToken({ idToken: authorization.slice(7), audience: settings.rtdnAudience });
    const p = ticket.getPayload();
    return p?.email === settings.rtdnPushEmail && p.email_verified === true;
  } catch {
    return false;
  }
};
