import 'dotenv/config';
import app from './app';
import connectDB from './config/db';
import logger from './utils/logger';
import { startScheduler } from './services/cronScheduler';
import { initTransport } from './services/emailService';
import { initSms } from './services/smsService';

const log = logger.child('Server');

// Connect to database
connectDB();

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  log.info('GaragePulse API Server started', {
    mode: process.env.NODE_ENV,
    port: PORT,
    url: `http://localhost:${PORT}`
  });

  // Initialize notification services and start cron scheduler
  initSms();
  initTransport().then(() => {
    startScheduler();
    log.info('Cron scheduler, email & SMS services initialized');
  }).catch(err => {
    log.warn('Email transport init failed, cron will still run but emails may not send', { error: (err as Error).message });
    startScheduler();
  });
});
