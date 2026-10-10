import { inArray } from 'drizzle-orm';
import { db } from '../config/db';
import { pushTokens } from '../config/schema';
import logger from '../utils/logger';

const log = logger.child('PushService');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
/** Expo accepts at most 100 messages per request. */
const BATCH_SIZE = 100;
const TIMEOUT_MS = 10_000;
/** The Android notification channel the mobile app must create with this same id. */
export const PUSH_CHANNEL_ID = 'requests';

export interface PushDelivery {
  userId: string;
  title: string;
  body: string;
  data: Record<string, string>;
}

interface ExpoMessage extends Omit<PushDelivery, 'userId'> {
  to: string;
  sound: 'default';
  channelId: string;
}

interface ExpoTicket {
  status: 'ok' | 'error';
  details?: { error?: string };
}

/**
 * Sends each user their message on every device they have registered. Never
 * throws: a push is a courtesy on top of the in-app notification, which is
 * already stored by the time this runs.
 *
 * ponytail: tickets only, no receipt polling — a push FCM later drops goes
 * unnoticed. Poll receipts if pushes start going missing.
 */
export const sendPush = async (deliveries: PushDelivery[]): Promise<void> => {
  if (!deliveries.length) return;
  try {
    const byUser = new Map(deliveries.map(d => [d.userId, d]));
    const rows = await db.select({ userId: pushTokens.userId, token: pushTokens.token })
      .from(pushTokens).where(inArray(pushTokens.userId, [...byUser.keys()]));

    const messages: ExpoMessage[] = rows.map(({ userId, token }) => {
      const { title, body, data } = byUser.get(userId)!;
      return { to: token, title, body, data, sound: 'default', channelId: PUSH_CHANNEL_ID };
    });
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      await sendBatch(messages.slice(i, i + BATCH_SIZE));
    }
  } catch (err) {
    log.warn('Push delivery failed', { error: (err as Error).message, recipients: deliveries.length });
  }
};

const sendBatch = async (messages: ExpoMessage[]): Promise<void> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(TIMEOUT_MS)
  });
  if (!res.ok) {
    log.warn('Expo rejected a push batch', { status: res.status, size: messages.length });
    return;
  }

  // Tickets come back in message order.
  const { data = [] } = (await res.json()) as { data?: ExpoTicket[] };
  const failures: Record<string, number> = {};
  for (const t of data) {
    if (t.status !== 'error' || t.details?.error === 'DeviceNotRegistered') continue;
    const code = t.details?.error ?? 'unknown';
    failures[code] = (failures[code] ?? 0) + 1;
  }
  const dead = data.flatMap((ticket, i) =>
    ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' ? [messages[i].to] : []);
  if (dead.length) {
    await db.delete(pushTokens).where(inArray(pushTokens.token, dead));
    log.info('Pruned unregistered push tokens', { count: dead.length });
  }
  if (Object.keys(failures).length) log.warn('Expo push tickets reported errors', { errors: failures, size: messages.length });
};
