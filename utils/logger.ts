import winston from 'winston';
import path from 'path';

const LOG_DIR = path.join(__dirname, '..', 'logs');

interface LogMeta {
  [key: string]: unknown;
}

// Custom format: [TIMESTAMP] [LEVEL] [SERVICE] message | key=value pairs
const structuredFormat = winston.format.printf(({ level, message, timestamp, service, ...meta }) => {
  const svc = service ? `[${service}]` : '[APP]';
  const metaStr = Object.keys(meta).length > 0
    ? ' | ' + Object.entries(meta).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')
    : '';
  return `[${timestamp}] [${String(level).toUpperCase()}] ${svc} ${message}${metaStr}`;
});

const baseLogger = winston.createLogger({
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

export interface ChildLogger {
  info: (message: string, meta?: LogMeta) => winston.Logger;
  warn: (message: string, meta?: LogMeta) => winston.Logger;
  error: (message: string, meta?: LogMeta) => winston.Logger;
  debug: (message: string, meta?: LogMeta) => winston.Logger;
  http: (message: string, meta?: LogMeta) => winston.Logger;
}

/**
 * Winston's built-in `child()` takes a metadata object; this app overrides it
 * with a service-name-scoped logger factory instead (see below) — an
 * intersection (not `extends`) avoids conflicting with winston.Logger's own
 * generic `child(): this` signature.
 */
export type AppLogger = winston.Logger & {
  /**
   * Create a child logger scoped to a specific service/module.
   * Usage: const log = logger.child('AuthService');
   *        log.info('User logged in', { userId: '123' });
   */
  child(serviceName: string): ChildLogger;
};

function createChildLogger(serviceName: string): ChildLogger {
  return {
    info: (message, meta = {}) => baseLogger.info(message, { service: serviceName, ...meta }),
    warn: (message, meta = {}) => baseLogger.warn(message, { service: serviceName, ...meta }),
    error: (message, meta = {}) => baseLogger.error(message, { service: serviceName, ...meta }),
    debug: (message, meta = {}) => baseLogger.debug(message, { service: serviceName, ...meta }),
    http: (message, meta = {}) => baseLogger.http(message, { service: serviceName, ...meta })
  };
}

(baseLogger as unknown as { child: (serviceName: string) => ChildLogger }).child = createChildLogger;

const logger = baseLogger as unknown as AppLogger;

export default logger;
