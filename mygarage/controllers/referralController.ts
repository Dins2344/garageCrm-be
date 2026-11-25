import { Request, Response } from 'express';
import * as referral from '../usecases/referralUsecase';
import { redeemSchema } from '../models/Referral';
import { HttpError } from '../../utils/httpError';

export const status = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await referral.status(res.locals.mgUserId) });
};

export const redeem = async (req: Request, res: Response): Promise<void> => {
  const body = redeemSchema.safeParse(req.body);
  if (!body.success) throw new HttpError('Code request was not valid.', 400);
  res.json({ success: true, data: await referral.redeem({ userId: res.locals.mgUserId, ...body.data }) });
};

export const activate = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await referral.activate(res.locals.mgUserId) });
};
