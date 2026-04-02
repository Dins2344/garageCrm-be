const express = require('express');
const path = require('path');
require('dotenv').config();
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const hpp = require('hpp');
const mongoSanitize = require('./middleware/mongoSanitize');

const connectDB = require('./config/db');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const { startScheduler } = require('./services/cronScheduler');
const { initTransport } = require('./services/emailService');

const log = logger.child('Server');

// Connect to database
connectDB();

const app = express();

// 1. CORS — Always at the very top to handle preflights correctly
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true
}));

// 2. Body Parser — Must come BEFORE security/sanitization
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 3. Security & Performance middleware — Now they have req.body to work with
app.use(helmet());           // Standard security headers
app.use(mongoSanitize);    // DATA SANITIZATION against NoSQL injection
app.use(hpp());             // PREVENT HTTP PARAMETER POLLUTION
app.use(compression());      // GZIP COMPRESSION for smaller payloads

// 4. Rate Limiting (Protects server from 1M+ user spam)
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 1000,
  message: { success: false, message: 'Too many requests from this IP' }
});
app.use('/api', limiter);

// HTTP request logging via morgan -> winston
const morganStream = {
  write: (message) => {
    const trimmed = message.trim();
    logger.info(trimmed, { service: 'HTTP' });
  }
};

app.use(morgan(':method :url :status :response-time ms - :res[content-length]', { stream: morganStream }));

// Static files (for uploaded photos)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// API Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/jobcards', require('./routes/jobCards'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/reminders', require('./routes/reminders'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'GarageFlow API is running', timestamp: new Date() });
});

// Error handler
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  log.info('GarageFlow API Server started', {
    mode: process.env.NODE_ENV,
    port: PORT,
    url: `http://localhost:${PORT}`
  });

  // Initialize email transport and start cron scheduler
  initTransport().then(() => {
    startScheduler();
    log.info('Cron scheduler and email service initialized');
  }).catch(err => {
    log.warn('Email transport init failed, cron will still run but emails may not send', { error: err.message });
    startScheduler();
  });
});

module.exports = app;
