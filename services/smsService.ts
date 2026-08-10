import twilio, { Twilio } from 'twilio';
import logger from '../utils/logger';
const log = logger.child('SmsService');

let twilioClient: Twilio | null = null;
let smsReady = false;

// ───── Initialize Twilio ─────
export const initSms = (): boolean => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    log.info('SMS service disabled — TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not configured');
    return false;
  }

  try {
    twilioClient = twilio(accountSid.trim(), authToken.trim());
    smsReady = true;
    log.info('Twilio SMS service initialized', {
      sid: accountSid.trim().slice(0, 8) + '...',
      from: process.env.TWILIO_PHONE_NUMBER || 'not set'
    });
    return true;
  } catch (err) {
    log.error('Failed to initialize Twilio', { error: (err as Error).message });
    smsReady = false;
    return false;
  }
};

// ───── isSmsConfigured ─────
export const isSmsConfigured = (): boolean => smsReady && twilioClient !== null;

interface SendSmsInput {
  to: string;
  body: string;
}

interface SendSmsResult {
  logged: boolean;
  sid: string | null;
  status?: string;
}

// ───── Send Raw SMS ─────
export const sendSms = async ({ to, body }: SendSmsInput): Promise<SendSmsResult> => {
  if (!isSmsConfigured() || !twilioClient) {
    log.info('SMS logged (Twilio not configured)', { to, body: body.slice(0, 80) });
    return { logged: true, sid: null };
  }

  const from = process.env.TWILIO_PHONE_NUMBER;
  if (!from) {
    log.warn('TWILIO_PHONE_NUMBER not set, cannot send SMS');
    return { logged: true, sid: null };
  }

  try {
    // Ensure phone is in E.164 format (Indian numbers: +91XXXXXXXXXX)
    const formattedTo = formatPhoneE164(to);

    const message = await twilioClient.messages.create({
      body,
      from: from.trim(),
      to: formattedTo
    });

    log.info('SMS sent successfully', { to: formattedTo, sid: message.sid, status: message.status });
    return { logged: false, sid: message.sid, status: message.status };
  } catch (err) {
    const error = err as Error & { code?: string };
    log.error('Failed to send SMS', { to, error: error.message, code: error.code });
    throw err;
  }
};

// ───── Format Phone to E.164 ─────
export const formatPhoneE164 = (phone: string): string => {
  if (!phone) return '';

  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');

  // Already has country code (starts with 91 and is 12 digits)
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }

  // Indian 10-digit number — prepend +91
  if (digits.length === 10) {
    return `+91${digits}`;
  }

  // Already in E.164 format
  if (phone.startsWith('+')) {
    return phone;
  }

  // Fallback — prepend +91
  return `+91${digits}`;
};

interface ServiceReminderSmsInput {
  customerName: string;
  customerPhone?: string;
  vehiclePlate: string;
  vehicleMake: string;
  vehicleModel: string;
  garageName: string;
  garagePhone: string;
  nextServiceDate: Date | string;
  reminderType: string;
}

interface SkippedResult {
  skipped: true;
  reason: string;
}

// ───── Service Reminder SMS Template ─────
export const sendServiceReminderSms = async ({
  customerName, customerPhone, vehiclePlate, vehicleMake, vehicleModel, garageName, garagePhone, nextServiceDate, reminderType
}: ServiceReminderSmsInput): Promise<SendSmsResult | SkippedResult> => {
  if (!customerPhone) {
    log.info('Skipping SMS — no customer phone', { customerName, vehiclePlate });
    return { skipped: true, reason: 'no_phone' };
  }

  const dateStr = new Date(nextServiceDate).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric'
  });

  const typeLabels: Record<string, string> = {
    periodic_service: 'periodic service',
    oil_change: 'oil change',
    tire_rotation: 'tire rotation',
    inspection: 'inspection',
    custom: 'service'
  };
  const serviceLabel = typeLabels[reminderType] || 'service';

  const body = `Hi ${customerName}! 🔧\n\nYour ${vehicleMake} ${vehicleModel} (${vehiclePlate}) is due for a ${serviceLabel} on ${dateStr}.\n\nCall us at ${garagePhone} to book your appointment.\n\n— ${garageName}`;

  return sendSms({ to: customerPhone, body });
};
