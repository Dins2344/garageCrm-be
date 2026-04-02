const logger = require('../utils/logger');

const log = logger.child('ErrorHandler');

const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

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
    error.message = 'Resource not found';
    log.warn('Invalid ObjectId provided', { path: err.path, value: err.value });
    return res.status(404).json({ success: false, message: error.message });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    error.message = `Duplicate value entered for '${field}'. This value already exists.`;
    log.warn('Duplicate key violation', { field, value: err.keyValue[field] });
    return res.status(400).json({ success: false, message: error.message });
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    error.message = messages.join('. ');
    log.warn('Validation error', { fields: Object.keys(err.errors), messages });
    return res.status(400).json({ success: false, message: error.message });
  }

  res.status(err.statusCode || 500).json({
    success: false,
    message: error.message || 'Server Error'
  });
};

module.exports = errorHandler;
