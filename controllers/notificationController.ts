import { Request, Response } from 'express';
import * as notificationUsecase from '../usecases/notificationUsecase';

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const me = (req: Request) => String(req.user!._id);

/** Inside nginx's 60 s proxy_read_timeout, which counts the gap between reads. */
export const STREAM_PING_MS = 25 * 1000;
/** Each stream ends so the browser's reconnect re-runs `protect`: deactivation, sliding cookie. */
export const STREAM_MAX_MS = 5 * 60 * 1000;
const STREAM_RETRY_MS = 3000;

// @desc    Server-Sent Events: a bare `changed` whenever the caller's unread
//          count may have moved. Never carries notification content.
// @route   GET /api/notifications/stream
export const streamNotifications = (req: Request, res: Response): void => {
  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no' // nginx would otherwise hold frames until its buffer fills
  });
  res.flushHeaders();

  const send = (frame: string) => {
    if (!res.writableEnded && !res.destroyed) res.write(frame);
  };
  send(`retry: ${STREAM_RETRY_MS}\n\n`);

  const unsubscribe = notificationUsecase.watchNotifications(me(req), () => send('event: changed\ndata: {}\n\n'));
  const ping = setInterval(() => send(': ping\n\n'), STREAM_PING_MS);
  const cap = setTimeout(() => res.end(), STREAM_MAX_MS);

  // res, not req: since Node 16 req's 'close' fires once a GET has been read, i.e. immediately.
  res.on('close', () => {
    unsubscribe();
    clearInterval(ping);
    clearTimeout(cap);
  });
};

// @desc    The caller's notifications, newest first, across every branch
// @route   GET /api/notifications
export const getNotifications = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as Record<string, string | string[] | undefined>;
  const { notifications, total, page, limit } = await notificationUsecase.listNotifications({
    userId: me(req), page: first(q.page), limit: first(q.limit)
  });
  res.status(200).json({
    success: true, count: notifications.length, total, pages: Math.ceil(total / limit), currentPage: page, data: notifications
  });
};

// @route   GET /api/notifications/unread-count
export const getUnreadCount = async (req: Request, res: Response): Promise<void> => {
  const count = await notificationUsecase.countUnread({ userId: me(req) });
  res.status(200).json({ success: true, data: { count } });
};

// @route   PUT /api/notifications/:id/read
export const readNotification = async (req: Request, res: Response): Promise<void> => {
  const notification = await notificationUsecase.markRead({ userId: me(req), notificationId: req.params.id as string });
  res.status(200).json({ success: true, data: notification });
};

// @route   PUT /api/notifications/read-all
export const readAllNotifications = async (req: Request, res: Response): Promise<void> => {
  const result = await notificationUsecase.markAllRead({ userId: me(req) });
  res.status(200).json({ success: true, data: result });
};

// @route   POST /api/notifications/push-token
export const savePushToken = async (req: Request, res: Response): Promise<void> => {
  await notificationUsecase.registerPushToken({ userId: me(req), data: req.body ?? {} });
  res.status(200).json({ success: true, message: 'Push token registered' });
};

// @route   DELETE /api/notifications/push-token
export const deletePushToken = async (req: Request, res: Response): Promise<void> => {
  await notificationUsecase.removePushToken({ userId: me(req), data: req.body ?? {} });
  res.status(200).json({ success: true, message: 'Push token removed' });
};
