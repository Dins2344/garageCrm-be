const logger = require('../utils/logger');
const log = logger.child('MongoSanitize');

/**
 * Custom MongoDB Sanitization Middleware for Express 5
 * Prevents NoSQL Injection by removing keys starting with $ or containing .
 * This version modifies properties in-place to avoid "read-only getter" errors in Express 5.
 */
const mongoSanitize = (req, res, next) => {
  const sanitize = (obj, path = '') => {
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
        sanitize(value, path ? `${path}.${key}` : key);
      }
    });
  };

  if (req.body) sanitize(req.body, 'body');
  if (req.query) sanitize(req.query, 'query');
  if (req.params) sanitize(req.params, 'params');

  next();
};

module.exports = mongoSanitize;
