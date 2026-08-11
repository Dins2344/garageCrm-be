import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Test env — never touch real secrets/services.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_do_not_use_in_prod';
process.env.JWT_EXPIRE = process.env.JWT_EXPIRE || '1h';
process.env.CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173';
process.env.SUPER_ADMIN_EMAIL = 'admin@test.local';
process.env.SUPER_ADMIN_PASSWORD = 'test-admin-password';
process.env.SUPER_ADMIN_SECRET = 'test_admin_secret';

// Never hit real SMTP/Twilio during tests.
vi.mock('../services/emailService', () => ({
  initTransport: vi.fn().mockResolvedValue(null),
  sendEmail: vi.fn().mockResolvedValue({ logged: true, messageId: null }),
  sendServiceReminder: vi.fn().mockResolvedValue({ skipped: true, reason: 'test' }),
  sendEstimationEmail: vi.fn().mockResolvedValue({ skipped: true, reason: 'test' })
}));

vi.mock('../services/smsService', () => ({
  initSms: vi.fn().mockReturnValue(false),
  isSmsConfigured: vi.fn().mockReturnValue(false),
  sendSms: vi.fn().mockResolvedValue({ logged: true, sid: null }),
  sendServiceReminderSms: vi.fn().mockResolvedValue({ skipped: true, reason: 'test' }),
  formatPhoneE164: vi.fn((phone: string) => phone)
}));

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
}, 60000);

afterEach(async () => {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map(c => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
