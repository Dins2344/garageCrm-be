import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Wraps an async route handler to catch errors and pass them to Express error handler.
 * Express 5 doesn't pass `next` to route handlers, so we need this wrapper.
 */
const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => unknown
): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
