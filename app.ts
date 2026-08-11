import express from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import hpp from 'hpp';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import os from 'os';
import swaggerUi from 'swagger-ui-express';

import mongoSanitize from './middleware/mongoSanitize';
import errorHandler from './middleware/errorHandler';
import logger from './utils/logger';
import swaggerSpec from './config/swagger';

import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import customerRoutes from './routes/customers';
import vehicleRoutes from './routes/vehicles';
import jobCardRoutes from './routes/jobCards';
import inventoryRoutes from './routes/inventory';
import invoiceRoutes from './routes/invoices';
import dashboardRoutes from './routes/dashboard';
import reminderRoutes from './routes/reminders';
import garageRoutes from './routes/garage';
import publicRoutes from './routes/public';
import adminRoutes from './routes/admin';

const app = express();

// ── Swagger API Documentation (mounted before helmet to avoid CSP issues) ──
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'GaragePulse API Docs'
}));
app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));

// 1. CORS — Always at the very top to handle preflights correctly
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));

// 2. Body Parser — Must come BEFORE security/sanitization
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());

// 3. Security & Performance middleware — Now they have req.body to work with
app.use(helmet());           // Standard security headers
app.use(mongoSanitize);      // DATA SANITIZATION against NoSQL injection
app.use(hpp());               // PREVENT HTTP PARAMETER POLLUTION
app.use(compression());       // GZIP COMPRESSION for smaller payloads

// 4. Rate Limiting (Protects server from 1M+ user spam)
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 1000,
  message: { success: false, message: 'Too many requests from this IP' }
});
app.use('/api', limiter);

// HTTP request logging via morgan -> winston
const morganStream = {
  write: (message: string) => {
    const trimmed = message.trim();
    logger.info(trimmed, { service: 'HTTP' });
  }
};

app.use(morgan(':method :url :status :response-time ms - :res[content-length]', { stream: morganStream }));

// Static files (for uploaded photos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/jobcards', jobCardRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reminders', reminderRoutes);
app.use('/api/garage', garageRoutes);
app.use('/api/public', publicRoutes); // No auth — token-secured
app.use('/api/admin', adminRoutes);   // Platform-wide admin

// Health check
app.get('/api/health', async (_req, res) => {
  const memUsage = process.memoryUsage();
  const formatMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];

  res.json({
    success: true,
    message: 'GaragePulse API is running',
    timestamp: new Date(),
    uptime: {
      process: Math.floor(process.uptime()) + 's',
      system: Math.floor(os.uptime()) + 's'
    },
    memory: {
      heapUsed: formatMB(memUsage.heapUsed),
      heapTotal: formatMB(memUsage.heapTotal),
      rss: formatMB(memUsage.rss),
      systemTotal: formatMB(os.totalmem()),
      systemFree: formatMB(os.freemem())
    },
    cpu: {
      cores: os.cpus().length,
      model: os.cpus()[0]?.model,
      loadAvg: os.loadavg().map(l => l.toFixed(2))
    },
    platform: {
      node: process.version,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch()
    },
    database: {
      status: dbStates[mongoose.connection.readyState] || 'unknown',
      host: mongoose.connection.host || 'N/A'
    },
    environment: process.env.NODE_ENV || 'development'
  });
});

// Error handler
app.use(errorHandler);

export default app;
