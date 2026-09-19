import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { pgError, isUniqueViolation, isForeignKeyViolation, uniqueViolationField } from '../utils/dbErrors';

const log = logger.child('ErrorHandler');

interface AppError extends Error {
  statusCode?: number;
}

const errorHandler = (err: AppError, req: Request, res: Response, _next: NextFunction): void => {
  let message = err.message;

  log.error('Request error caught', {
    method: req.method,
    url: req.originalUrl,
    garageId: req.garageId,
    userId: req.user?._id,
    errorName: err.name,
    errorMessage: err.message,
    statusCode: err.statusCode || 500,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });

  // Unique index violation — same wording the clients have always shown.
  if (isUniqueViolation(err)) {
    const field = uniqueViolationField(err);
    message = `Duplicate value entered for '${field}'. This value already exists.`;
    log.warn('Duplicate key violation', { field, constraint: pgError(err)?.constraint });
    res.status(400).json({ success: false, message });
    return;
  }

  // A foreign key stopped a delete (dependent rows exist) or an insert named a
  // parent that does not exist. Usecases normally catch this first with a
  // specific message; this is the backstop.
  if (isForeignKeyViolation(err)) {
    message = 'This record is referenced by other records and cannot be changed.';
    log.warn('Foreign key violation', { constraint: pgError(err)?.constraint });
    res.status(409).json({ success: false, message });
    return;
  }

  // Any other database error must never leak its SQL to a client.
  if (pgError(err) && !err.statusCode) {
    res.status(500).json({ success: false, message: 'Server Error' });
    return;
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: message || 'Server Error'
  });
};

export default errorHandler;
