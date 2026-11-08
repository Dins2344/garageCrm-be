import { Request, Response } from 'express';
import * as authUsecase from '../usecases/authUsecase';
import { HttpError } from '../../utils/httpError';

const field = (req: Request, name: 'idToken' | 'refreshToken'): string => {
  const value = (req.body as Record<string, unknown> | undefined)?.[name];
  if (typeof value !== 'string' || !value) throw new HttpError('Sign-in request was not valid.', 400);
  return value;
};

export const google = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await authUsecase.signInWithGoogle({ idToken: field(req, 'idToken') }) });
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await authUsecase.refreshSession({ refreshToken: field(req, 'refreshToken') }) });
};

export const signOut = async (req: Request, res: Response): Promise<void> => {
  await authUsecase.signOut({ refreshToken: field(req, 'refreshToken') });
  res.json({ success: true });
};

export const me = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await authUsecase.getMe({ userId: res.locals.mgUserId }) });
};

export const key = async (_req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: { key: await authUsecase.getDataKey({ userId: res.locals.mgUserId }) } });
};
