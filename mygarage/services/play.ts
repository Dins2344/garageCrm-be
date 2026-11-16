import { JWT, OAuth2Client } from 'google-auth-library';
import { getMyGarageEnv } from '../config/env';
import { HttpError } from '../../utils/httpError';

export const PACKAGE = 'com.dctechs.mygarage';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}/purchases`;
export const PURCHASES_OFF = 'Purchases are unavailable right now. Try again later.';

/** The parts of Play's SubscriptionPurchaseV2 we read. */
export type PlaySubscription = {
  subscriptionState?: string;
  acknowledgementState?: string;
  linkedPurchaseToken?: string;
  externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string };
  lineItems?: { productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean }; offerDetails?: { basePlanId?: string } }[];
};

let client: { email: string; jwt: JWT } | null = null;
const play = (): JWT => {
  const settings = getMyGarageEnv().play;
  if (!settings) throw new HttpError(PURCHASES_OFF, 503);
  if (client?.email !== settings.email) {
    client = { email: settings.email, jwt: new JWT({ email: settings.email, key: settings.key, scopes: ['https://www.googleapis.com/auth/androidpublisher'] }) };
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
