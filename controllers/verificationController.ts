import { Request, Response } from 'express';
import * as verificationUsecase from '../usecases/verificationUsecase';
import { isVerificationChannel, VERIFICATION_CHANNELS } from '../models/VerificationChallenge';
import { HttpError } from '../utils/httpError';
import logger from '../utils/logger';
const log = logger.child('VerificationController');

const channelParam = (req: Request) => {
  const channel = req.params.channel as string;
  if (!isVerificationChannel(channel)) {
    throw new HttpError(`Channel must be one of: ${VERIFICATION_CHANNELS.join(', ')}`, 400);
  }
  return channel;
};

// @desc    Verified state of the caller's email and phone
// @route   GET /api/auth/verification
export const getStatus = async (req: Request, res: Response): Promise<void> => {
  const status = await verificationUsecase.getVerificationStatus({ userId: req.user!._id });
  res.status(200).json({ success: true, data: status });
};

// @desc    Send a one-time code to the caller's email or phone
// @route   POST /api/auth/verification/:channel/send
export const sendCode = async (req: Request, res: Response): Promise<void> => {
  const channel = channelParam(req);
  log.info('Verification code requested', { userId: req.user!._id, channel });
  const result = await verificationUsecase.sendVerificationCode({ userId: req.user!._id, channel });
  res.status(200).json({ success: true, data: result });
};

// @desc    Confirm a one-time code
// @route   POST /api/auth/verification/:channel/confirm
export const confirmCode = async (req: Request, res: Response): Promise<void> => {
  const channel = channelParam(req);
  const user = await verificationUsecase.confirmVerificationCode({ userId: req.user!._id, channel, code: req.body?.code });
  log.info('Verification confirmed', { userId: req.user!._id, channel });
  res.status(200).json({ success: true, data: user });
};
