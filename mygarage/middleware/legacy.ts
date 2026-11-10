import { Request, Response, NextFunction } from 'express';
import { isInAnyGarage } from '../usecases/garageUsecase';

/** Old apps know only the personal scope: once a user is in a shared garage they must update rather than sync partially. */
export const refuseIfSharing = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (await isInAnyGarage(res.locals.mgUserId)) {
    res.status(426).json({ success: false, message: 'Update MyGarage to keep syncing.' });
    return;
  }
  next();
};
