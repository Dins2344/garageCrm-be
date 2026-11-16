import { Request, Response } from 'express';
import * as billing from '../usecases/billingUsecase';
import { BILLING_BAD_INPUT, notificationSchema, pushSchema, verifySchema } from '../models/Subscription';
import { isPlayPush } from '../services/play';
import { HttpError } from '../../utils/httpError';

export const entitlement = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await billing.entitlementOf({ userId: res.locals.mgUserId }) });
};

export const verify = async (req: Request, res: Response): Promise<void> => {
  const body = verifySchema.safeParse(req.body);
  if (!body.success) throw new HttpError(BILLING_BAD_INPUT, 400);
  res.json({ success: true, data: await billing.verifyPurchase({ userId: res.locals.mgUserId, purchaseToken: body.data.purchaseToken }) });
};

const decode = (data: string): unknown => {
  try {
    return JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

/**
 * Google Play's Real-time Developer Notifications, pushed by Pub/Sub. Any 2xx tells Pub/Sub the message is done,
 * so a body we cannot use gets 204 (retrying it would never help) and only a Play failure gets a retry.
 */
export const notification = async (req: Request, res: Response): Promise<void> => {
  if (!(await isPlayPush(req.headers.authorization))) throw new HttpError('Not allowed.', 401);
  const push = pushSchema.safeParse(req.body);
  const n = push.success ? notificationSchema.safeParse(decode(push.data.message.data)) : null;
  if (n?.success) await billing.handleNotification(n.data);
  res.status(204).end();
};
