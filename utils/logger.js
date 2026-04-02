const winston = require('winston');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Custom format: [TIMESTAMP] [LEVEL] [SERVICE] message | key=value pairs
const structuredFormat = winston.format.printf(({ level, message, timestamp, service, ...meta }) => {
  const svc = service ? `[${service}]` : '[APP]';
  const metaStr = Object.keys(meta).length > 0
    ? ' | ' + Object.entries(meta).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')
    : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${svc} ${message}${metaStr}`;
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    structuredFormat
  ),
  transports: [
    // Console transport — always enabled
    new winston.transports.Console(),

    // Combined log file
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'combined.log'),
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5
    }),

    // Error-only log file
    new winston.transports.File({
      filename: path.join(LOG_DIR, 'error.log'),
      level: 'error',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5
    })
  ]
});

/**
 * Create a child logger scoped to a specific service/module.
 * Usage: const log = require('../utils/logger').child('AuthService');
 *        log.info('User logged in', { userId: '123' });
 */
logger.child = (serviceName) => {
  return {
    info: (message, meta = {}) => logger.info(message, { service: serviceName, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { service: serviceName, ...meta }),
    error: (message, meta = {}) => logger.error(message, { service: serviceName, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { service: serviceName, ...meta }),
    http: (message, meta = {}) => logger.http(message, { service: serviceName, ...meta })
  };
};

module.exports = logger;
