import { Request, Response, NextFunction } from 'express';
import { HttpError } from '../../utils/httpError';
import logger from '../../utils/logger';

const log = logger.child('MyGarageErrors');

const UNAVAILABLE = 'Sync is unavailable right now. Try again later.';

const statusOf = (err: unknown): number | null => {
  const e = err as { statusCode?: unknown; status?: unknown };
  const s = typeof e?.statusCode === 'number' ? e.statusCode : typeof e?.status === 'number' ? e.status : null;
  return s !== null && s >= 400 && s < 500 ? s : null;
};

/**
 * MyGarage's own error handler. Database errors carry their SQL and parameters
 * in the message, so nothing but the error name is logged and nothing from the
 * error is sent to the phone, except messages from our own HttpError.
 */
export const mgErrorHandler = (err: Error, _req: Request, res: Response, next: NextFunction): void => {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.statusCode).json({ success: false, message: err.message });
    return;
  }
  const status = statusOf(err);
  if (status !== null) {
    // Body-parser errors: never echo the parser's message, it can quote the body.
    res.status(status).json({
      success: false,
      message: status === 413 ? 'Too much data in one request.' : 'Sync data was not in the expected format.'
    });
    return;
  }
  log.error('MyGarage request failed', { errorName: err?.name, userId: res.locals.mgUserId });
  res.status(503).json({ success: false, message: UNAVAILABLE });
};
