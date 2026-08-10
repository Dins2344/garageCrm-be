import cron from 'node-cron';
import { Types } from 'mongoose';
import ServiceReminder from '../models/ServiceReminder';
import { sendServiceReminder } from '../services/emailService';
import { sendServiceReminderSms, isSmsConfigured } from '../services/smsService';
import logger from '../utils/logger';
const log = logger.child('CronScheduler');

interface DueReminder {
  _id: Types.ObjectId;
  customer?: { name?: string; email?: string; phone?: string } | null;
  vehicle?: { licensePlate?: string; make?: string; model?: string } | null;
  garage?: { name?: string; phone?: string } | null;
  nextServiceDate: Date;
  type: string;
  notes?: string;
}

interface ProcessResult {
  processed: number;
  emailSent: number;
  smsSent: number;
  skipped: number;
  failed: number;
}

interface ProcessError {
  error: string;
}

// ───────────────────────────────────────────────
// Job 1: Process Service Reminders
// Runs every day at 9:00 AM server time
// Finds all pending reminders due within the next 7 days
// Sends email + SMS notifications and marks them as 'sent'
// ───────────────────────────────────────────────
export const processServiceReminders = async (): Promise<ProcessResult | ProcessError> => {
  const jobStart = Date.now();
  log.info('Cron: Starting service reminder processing');

  try {
    const now = new Date();
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    // Find all pending reminders that are due within 7 days (or already overdue)
    const dueReminders = await ServiceReminder.find({
      status: 'pending',
      nextServiceDate: { $lte: sevenDaysFromNow }
    })
      .populate('vehicle', 'licensePlate make model')
      .populate('customer', 'name phone email')
      .populate('garage')
      .lean<DueReminder[]>();

    if (dueReminders.length === 0) {
      log.info('Cron: No pending reminders found');
      return { processed: 0, emailSent: 0, smsSent: 0, skipped: 0, failed: 0 };
    }

    log.info(`Cron: Found ${dueReminders.length} reminders to process`);

    let emailSent = 0;
    let smsSent = 0;
    let skipped = 0;
    let failed = 0;

    for (const reminder of dueReminders) {
      try {
        const reminderData = {
          customerName: reminder.customer?.name || 'Customer',
          customerEmail: reminder.customer?.email,
          customerPhone: reminder.customer?.phone,
          vehiclePlate: reminder.vehicle?.licensePlate || 'Unknown',
          vehicleMake: reminder.vehicle?.make || '',
          vehicleModel: reminder.vehicle?.model || '',
          garageName: reminder.garage?.name || 'GaragePulse',
          garagePhone: reminder.garage?.phone || '',
          nextServiceDate: reminder.nextServiceDate,
          reminderType: reminder.type
        };

        let notesAppend = '';
        let anySent = false;

        // ── Send Email ──
        try {
          const emailResult = await sendServiceReminder(reminderData);
          if ('skipped' in emailResult) {
            notesAppend += `\n[Cron] Email skipped: ${emailResult.reason}`;
          } else {
            emailSent++;
            anySent = true;
            notesAppend += `\n[Cron] Email sent to ${reminder.customer?.email} at ${now.toISOString()}`;
            if (emailResult.previewUrl) {
              notesAppend += `\n[Ethereal Preview] ${emailResult.previewUrl}`;
            }
          }
        } catch (emailErr) {
          notesAppend += `\n[Cron] Email failed: ${(emailErr as Error).message}`;
          log.warn('Email send failed for reminder', { reminderId: reminder._id, error: (emailErr as Error).message });
        }

        // ── Send SMS ──
        try {
          const smsResult = await sendServiceReminderSms(reminderData);
          if ('skipped' in smsResult) {
            notesAppend += `\n[Cron] SMS skipped: ${smsResult.reason}`;
          } else if (smsResult.logged) {
            notesAppend += '\n[Cron] SMS logged (Twilio not configured)';
          } else {
            smsSent++;
            anySent = true;
            notesAppend += `\n[Cron] SMS sent to ${reminder.customer?.phone} (SID: ${smsResult.sid})`;
          }
        } catch (smsErr) {
          notesAppend += `\n[Cron] SMS failed: ${(smsErr as Error).message}`;
          log.warn('SMS send failed for reminder', { reminderId: reminder._id, error: (smsErr as Error).message });
        }

        // ── Update reminder status ──
        if (anySent) {
          await ServiceReminder.findByIdAndUpdate(reminder._id, {
            status: 'sent',
            reminderSentAt: now,
            notes: (reminder.notes || '') + notesAppend
          });

          log.info('Cron: Reminder sent', {
            reminderId: reminder._id,
            customer: reminder.customer?.name,
            vehicle: reminder.vehicle?.licensePlate,
            email: emailSent > 0,
            sms: smsSent > 0
          });
        } else {
          // Neither email nor SMS succeeded — keep as pending for retry
          skipped++;
          await ServiceReminder.findByIdAndUpdate(reminder._id, {
            notes: (reminder.notes || '') + notesAppend
          });
        }
      } catch (err) {
        failed++;
        log.error('Cron: Failed to process reminder', {
          reminderId: reminder._id,
          error: (err as Error).message
        });

        await ServiceReminder.findByIdAndUpdate(reminder._id, {
          notes: (reminder.notes || '') + `\n[Cron Error] ${now.toISOString()}: ${(err as Error).message}`
        });
      }
    }

    const duration = Date.now() - jobStart;
    log.info('Cron: Service reminder processing complete', {
      total: dueReminders.length,
      emailSent,
      smsSent,
      skipped,
      failed,
      smsConfigured: isSmsConfigured(),
      durationMs: duration
    });

    return { processed: dueReminders.length, emailSent, smsSent, skipped, failed };
  } catch (err) {
    log.error('Cron: Fatal error in reminder processing', { error: (err as Error).message, stack: (err as Error).stack });
    return { error: (err as Error).message };
  }
};

// ───────────────────────────────────────────────
// Job 2: Clean up old dismissed/completed reminders
// Runs every Sunday at 2:00 AM
// Removes reminders completed/dismissed more than 90 days ago
// ───────────────────────────────────────────────
export const cleanupOldReminders = async (): Promise<{ deleted: number } | ProcessError> => {
  log.info('Cron: Starting old reminder cleanup');

  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const result = await ServiceReminder.deleteMany({
      status: { $in: ['completed', 'dismissed'] },
      updatedAt: { $lt: ninetyDaysAgo }
    });

    log.info('Cron: Old reminder cleanup complete', { deleted: result.deletedCount });
    return { deleted: result.deletedCount };
  } catch (err) {
    log.error('Cron: Cleanup error', { error: (err as Error).message });
    return { error: (err as Error).message };
  }
};

// ───────────────────────────────────────────────
// Scheduler Bootstrap
// ───────────────────────────────────────────────
export const startScheduler = (): void => {
  // Daily at 9:00 AM — Process service reminders
  cron.schedule('0 9 * * *', () => {
    processServiceReminders();
  }, {
    timezone: 'Asia/Kolkata'
  });
  log.info('Cron job registered: Service reminders (daily 9:00 AM IST)');

  // Every Sunday at 2:00 AM — Cleanup old reminders
  cron.schedule('0 2 * * 0', () => {
    cleanupOldReminders();
  }, {
    timezone: 'Asia/Kolkata'
  });
  log.info('Cron job registered: Reminder cleanup (Sunday 2:00 AM IST)');

  // Immediate first run on startup (after 10s delay so DB is ready)
  setTimeout(() => {
    log.info('Running initial reminder check on startup...');
    processServiceReminders();
  }, 10000);
};
