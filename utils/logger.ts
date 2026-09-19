import winston from 'winston';
import path from 'path';

const LOG_DIR = path.join(__dirname, '..', 'logs');

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

/**
 * `logger.child('AuthService')` — winston's own `child()` with the service
 * name as its default metadata, so every line carries `[AuthService]`.
 */
export type AppLogger = Omit<winston.Logger, 'child'> & { child(serviceName: string): winston.Logger };

const nativeChild = baseLogger.child.bind(baseLogger);
const logger = Object.assign(baseLogger, { child: (serviceName: string) => nativeChild({ service: serviceName }) }) as unknown as AppLogger;

export default logger;
