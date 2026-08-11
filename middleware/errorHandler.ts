import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';

const log = logger.child('ErrorHandler');

interface AppError extends Error {
  statusCode?: number;
  code?: number;
  keyValue?: Record<string, unknown>;
  errors?: Record<string, { message: string }>;
  path?: string;
  value?: unknown;
}

const errorHandler = (err: AppError, req: Request, res: Response, _next: NextFunction): void => {
  let message = err.message;

  log.error('Request error caught', {
    method: req.method,
    url: req.originalUrl,
    errorName: err.name,
    errorMessage: err.message,
    statusCode: err.statusCode || 500,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    message = 'Resource not found';
    log.warn('Invalid ObjectId provided', { path: err.path, value: err.value });
    res.status(404).json({ success: false, message });
    return;
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    message = `Duplicate value entered for '${field}'. This value already exists.`;
    log.warn('Duplicate key violation', { field, value: err.keyValue?.[field] });
    res.status(400).json({ success: false, message });
    return;
  }

  // Mongoose validation error
  if (err.name === 'ValidationError' && err.errors) {
    const messages = Object.values(err.errors).map(val => val.message);
    message = messages.join('. ');
    log.warn('Validation error', { fields: Object.keys(err.errors), messages });
    res.status(400).json({ success: false, message });
    return;
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: message || 'Server Error'
  });
};

export default errorHandler;
