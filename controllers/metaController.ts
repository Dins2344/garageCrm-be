import { Request, Response, NextFunction } from 'express';
import * as appReleaseUsecase from '../usecases/appReleaseUsecase';
import logger from '../utils/logger';

const log = logger.child('MetaController');

/**
 * `routes/meta.ts` has no controller for `/countries` because that handler
 * reads a static module and cannot throw. This one hits the database, so it
 * follows the normal controller -> usecase shape.
 */

// @desc    Whether this app build should update, and whether it must
// @route   GET /api/meta/app-update
export const getAppUpdate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const platform = String(req.query.platform ?? '');
    const version = String(req.query.version ?? '');

    const decision = await appReleaseUsecase.getUpdateDecision({ platform, version });

    // No intermediary may hand one build's decision to another. The response
    // is per-version by definition, and a shared cache would be the one way a
    // correct policy still blocks the wrong device.
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ success: true, data: decision });
  } catch (error) {
    log.error('App update check failed', { error: (error as Error).message });
    next(error);
  }
};
