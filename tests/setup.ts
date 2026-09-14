import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../config/schema';
import { setDb, MIGRATIONS_FOLDER, Db } from '../config/db';

// Test env — never touch real secrets/services.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_do_not_use_in_prod';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '1h';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
// Admin identity lives in the database now — see tests/helpers/factories.ts
// createSuperAdmin(). Only the token-signing secret is env-supplied.
process.env.SUPER_ADMIN_SECRET = 'test_admin_secret';

// Never hit real SMTP/Twilio during tests.
vi.mock('../services/emailService', () => ({
  initTransport: vi.fn().mockResolvedValue(null),
  sendEmail: vi.fn().mockResolvedValue({ logged: true, messageId: null }),
  sendServiceReminder: vi.fn().mockResolvedValue({ skipped: true, reason: 'test' }),
  sendEstimationEmail: vi.fn().mockResolvedValue({ skipped: true, reason: 'test' }),
  sendPasswordResetEmail: vi.fn().mockResolvedValue({ skipped: true, reason: 'test' }),
  sendVerificationEmail: vi.fn().mockResolvedValue({ logged: true, messageId: null })
}));

vi.mock('../services/smsService', () => ({
  initSms: vi.fn().mockReturnValue(false),
  isSmsConfigured: vi.fn().mockReturnValue(false),
  sendSms: vi.fn().mockResolvedValue({ logged: true, sid: null }),
  sendServiceReminderSms: vi.fn().mockResolvedValue({ skipped: true, reason: 'test' }),
  formatPhoneE164: vi.fn((phone: string) => phone)
}));

// A real Postgres, in-process, per test file: the same migrations production
// applies at boot run here, so tests exercise the actual constraints, foreign
// keys and unique indexes rather than an approximation of them.
let pglite: PGlite;

beforeAll(async () => {
  pglite = new PGlite();
  const instance = drizzle(pglite, { schema, casing: 'snake_case' });
  await migrate(instance, { migrationsFolder: MIGRATIONS_FOLDER });
  setDb(instance as unknown as Db);
}, 60000);

afterEach(async () => {
  await pglite.exec(
    'TRUNCATE TABLE admins, app_releases, garages, users, verification_challenges, customers, vehicles, inventory, job_cards, invoices, service_reminders CASCADE'
  );
});

afterAll(async () => {
  await pglite.close();
});
