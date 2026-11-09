import { Request, Response, NextFunction } from 'express';
import { userIdFromAccessToken, SESSION_ENDED } from '../usecases/authUsecase';
import { HttpError } from '../../utils/httpError';

/** Sets res.locals.mgUserId from a MyGarage access token. GaragePulse tokens fail the signature check. */
export const requireUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const header = req.headers.authorization;
  const userId = header?.startsWith('Bearer ') ? await userIdFromAccessToken(header.slice(7)) : null;
  if (!userId) {
    next(new HttpError(SESSION_ENDED, 401));
    return;
  }
  res.locals.mgUserId = userId;
  next();
};
