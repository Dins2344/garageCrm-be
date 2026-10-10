import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../config/db';
import { notifications, notificationToApi } from '../models/Notification';
import { pushTokens, registerPushTokenSchema, removePushTokenSchema } from '../models/PushToken';
import { NotificationType } from '../types/domain';
import { sendPush } from '../services/pushService';
import { runSchema } from '../utils/validation';
import { pagination } from '../utils/query';
import { isObjectIdHex } from '../utils/ids';
import { ApiObject } from '../utils/serialize';
import { HttpError } from '../utils/httpError';
import logger from '../utils/logger';

const log = logger.child('NotificationUsecase');

interface NotifyInput {
  userIds: string[];
  garageId: string;
  type: NotificationType;
  title: string;
  body: string;
  entityType: string;
  entityId: string;
}

/**
 * Stores one notification per recipient, then pushes in the background. The
 * caller never waits on Expo, and `sendPush` never throws.
 */
export const notifyUsers = async ({ userIds, garageId, type, title, body, entityType, entityId }: NotifyInput): Promise<void> => {
  const recipients = [...new Set(userIds)];
  if (!recipients.length) return;

  const rows = await db.insert(notifications)
    .values(recipients.map(userId => ({ userId, garageId, type, title, body, entityType, entityId })))
    .returning({ _id: notifications._id, userId: notifications.userId });
  log.info('Notifications stored', { type, entityType, entityId, recipients: rows.length });

  void sendPush(rows.map(row => ({
    userId: row.userId,
    title,
    body,
    data: { notificationId: row._id, type, entityType, entityId, garageId }
  })));
};

interface EntityInput {
  entityType: string;
  entityId: string;
  type: NotificationType;
}

/** Every unread notification of this type about this entity no longer needs anyone's attention. */
export const markEntityRead = async ({ entityType, entityId, type }: EntityInput): Promise<void> => {
  await db.update(notifications).set({ readAt: new Date() }).where(and(
    eq(notifications.entityType, entityType),
    eq(notifications.entityId, entityId),
    eq(notifications.type, type),
    isNull(notifications.readAt)
  ));
};

interface ListInput {
  userId: string;
  page?: number | string;
  limit?: number | string;
}

export const listNotifications = async ({ userId, page = 1, limit = 20 }: ListInput) => {
  const paging = pagination(page, limit);
  const where = eq(notifications.userId, userId);
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(notifications).where(where),
    db.query.notifications.findMany({
      where,
      orderBy: [desc(notifications.createdAt), desc(notifications._id)],
      offset: paging.offset,
      limit: paging.limit
    })
  ]);
  return { notifications: rows.map(notificationToApi), total, page: paging.page, limit: paging.limit };
};

export const countUnread = async ({ userId }: { userId: string }): Promise<number> => {
  const [{ unread }] = await db.select({ unread: count() }).from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return unread;
};

export const markRead = async ({ userId, notificationId }: { userId: string; notificationId: string }): Promise<ApiObject> => {
  const [row] = isObjectIdHex(notificationId)
    ? await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications._id, notificationId), eq(notifications.userId, userId)))
      .returning()
    : [];
  if (!row) throw new HttpError('Notification not found', 404);
  return notificationToApi(row);
};

export const markAllRead = async ({ userId }: { userId: string }): Promise<{ updated: number }> => {
  const rows = await db.update(notifications).set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
    .returning({ _id: notifications._id });
  return { updated: rows.length };
};

interface TokenInput {
  userId: string;
  data: Record<string, unknown>;
}

/** Upsert on the token: a shared phone moves to whoever signed in on it last. */
export const registerPushToken = async ({ userId, data }: TokenInput): Promise<void> => {
  const { token, platform } = runSchema(registerPushTokenSchema, data);
  await db.insert(pushTokens).values({ userId, token, platform })
    .onConflictDoUpdate({ target: pushTokens.token, set: { userId, platform, updatedAt: new Date() } });
  log.info('Push token registered', { userId, platform });
};

/** Removes the device only if it is the caller's — another user's sign-out must not silence it. */
export const removePushToken = async ({ userId, data }: TokenInput): Promise<void> => {
  const { token } = runSchema(removePushTokenSchema, data);
  await db.delete(pushTokens).where(and(eq(pushTokens.token, token), eq(pushTokens.userId, userId)));
  log.info('Push token removed', { userId });
};
