import 'dotenv/config';
import app from './app';
import connectDB from './config/db';
import logger from './utils/logger';
import { startScheduler } from './services/cronScheduler';
import { initTransport } from './services/emailService';
import { initSms } from './services/smsService';
import { and, count, eq } from 'drizzle-orm';
import { db } from './config/db';
import { admins } from './models/Admin';

const log = logger.child('Server');

/**
 * Admin credentials used to be env vars with hardcoded fallbacks, so a
 * deployment that configured nothing still had a working — and publicly
 * known — admin login. Now nothing is implicit, which means a misconfigured
 * deployment has no admin at all. Say so at boot rather than letting someone
 * discover it when they need the console.
 */
async function checkAdminSetup(): Promise<void> {
  if (!process.env.SUPER_ADMIN_SECRET) {
    log.error('SUPER_ADMIN_SECRET is not set — the admin console cannot issue or verify tokens');
    return;
  }
  if (process.env.SUPER_ADMIN_SECRET === process.env.JWT_SECRET) {
    log.error('SUPER_ADMIN_SECRET matches JWT_SECRET — a user token could be replayed as an admin token');
  }
  try {
    const [{ active }] = await db.select({ active: count() }).from(admins).where(and(eq(admins.isActive, true)));
    if (active === 0) {
      log.warn('No active platform admin exists — create one with: npx tsx scripts/manageAdmin.ts create <email> "<Name>"');
    } else {
      log.info('Platform admin accounts available', { active });
    }
  } catch (err) {
    log.warn('Could not check admin accounts at startup', { error: (err as Error).message });
  }
}

const PORT = process.env.PORT || 5000;

// The database handle must be bound before the first request: unlike
// Mongoose, nothing buffers queries until a connection appears. `connectDB`
// also applies pending schema migrations, so a boot that cannot migrate never
// starts serving.
connectDB().then(() => app.listen(PORT, () => {
  log.info('GaragePulse API Server started', {
    mode: process.env.NODE_ENV,
    port: PORT,
    url: `http://localhost:${PORT}`
  });

  // Diagnostic only — must never take the server down with it.
  checkAdminSetup().catch(err =>
    log.warn('Admin setup check failed', { error: (err as Error).message })
  );

  // Initialize notification services and start cron scheduler
  initSms();
  initTransport().then(() => {
    startScheduler();
    log.info('Cron scheduler, email & SMS services initialized');
  }).catch(err => {
    log.warn('Email transport init failed, cron will still run but emails may not send', { error: (err as Error).message });
    startScheduler();
  });
}));
