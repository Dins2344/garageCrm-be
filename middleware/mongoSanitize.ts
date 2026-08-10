import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

const log = logger.child('MongoSanitize');

/**
 * Custom MongoDB Sanitization Middleware for Express 5
 * Prevents NoSQL Injection by removing keys starting with $ or containing .
 * This version modifies properties in-place to avoid "read-only getter" errors in Express 5.
 */
const sanitize = (obj: Record<string, unknown> | undefined | null, path: string, req: Request): void => {
  if (!obj || typeof obj !== 'object') return;

  Object.keys(obj).forEach(key => {
    const value = obj[key];

    // If key starts with $ or contains ., it's a potential NoSQL injection
    if (key.startsWith('$') || key.includes('.')) {
      log.warn('NoSQL Injection attempt blocked', {
        path: path ? `${path}.${key}` : key,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip
      });
      delete obj[key];
    } else if (value && typeof value === 'object') {
      // Recursive sanitization for nested objects
      sanitize(value as Record<string, unknown>, path ? `${path}.${key}` : key, req);
    }
  });
};

const mongoSanitize = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.body) sanitize(req.body, 'body', req);
  if (req.query) sanitize(req.query as Record<string, unknown>, 'query', req);
  if (req.params) sanitize(req.params as Record<string, unknown>, 'params', req);

  next();
};

export default mongoSanitize;
