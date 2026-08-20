import cron from 'node-cron';
import { Types } from 'mongoose';
import ServiceReminder from '../models/ServiceReminder';
import { sendServiceReminder } from '../services/emailService';
import { sendServiceReminderSms, isSmsConfigured } from '../services/smsService';
import logger from '../utils/logger';
import { resolveGarageLocale, LocaleSource } from '../utils/locale';
import { hourInTimezone } from '../utils/format';
const log = logger.child('CronScheduler');

/** Local wall-clock hour at which a garage's reminders go out. */
const REMINDER_SEND_HOUR = 9;

/**
 * How long after an attempt the same reminder may be attempted again.
 * The hourly job visits each garage's 09:00 exactly once a day, so this only
 * guards against a redeploy landing inside that same hour.
 */
const REATTEMPT_COOLDOWN_MS = 12 * 60 * 60 * 1000;

interface DueReminder {
  _id: Types.ObjectId;
  customer?: { name?: string; email?: string; phone?: string } | null;
  vehicle?: { licensePlate?: string; make?: string; model?: string } | null;
  garage?: (LocaleSource & { name?: string; phone?: string }) | null;
  nextServiceDate: Date;
  type: string;
  notes?: string;
  lastAttemptAt?: Date | null;
}

interface ProcessResult {
  processed: number;
  emailSent: number;
  smsSent: number;
  skipped: number;
  failed: number;
  /** Due, but it isn't 09:00 yet in that garage's own timezone. */
  heldForLocalTime: number;
}

interface ProcessError {
  error: string;
}

interface ProcessOptions {
  /**
   * When true (the scheduled path), a reminder is only sent during the hour
   * that is 09:00 in its own garage's timezone. The manual trigger passes
   * false — an owner clicking "send now" means now.
   */
  respectLocalHour?: boolean;
  /** Injectable clock, for tests. */
  now?: Date;
}

// ───────────────────────────────────────────────
// Job 1: Process Service Reminders
// Runs HOURLY in UTC; each reminder is sent only during the hour that reads
// 09:00 in its own garage's timezone. Finds all pending reminders due within
// the next 7 days, sends email + SMS, and marks them as 'sent'.
//
// Deliberately NOT one cron job per garage timezone: that scales with tenants
// and leaves orphaned schedules whenever a garage changes country. One hourly
// sweep plus a per-garage predicate is O(1) jobs and always reflects current
// data.
// ───────────────────────────────────────────────
export const processServiceReminders = async (
  { respectLocalHour = false, now = new Date() }: ProcessOptions = {}
): Promise<ProcessResult | ProcessError> => {
  const jobStart = Date.now();
  log.info('Cron: Starting service reminder processing', { respectLocalHour });

  try {
    const sevenDaysFromNow = new Date(now);
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
      return { processed: 0, emailSent: 0, smsSent: 0, skipped: 0, failed: 0, heldForLocalTime: 0 };
    }

    log.info(`Cron: Found ${dueReminders.length} reminders to process`);

    let emailSent = 0;
    let smsSent = 0;
    let skipped = 0;
    let failed = 0;
    let heldForLocalTime = 0;

    for (const reminder of dueReminders) {
      try {
        const locale = resolveGarageLocale(reminder.garage);

        // ── Local-time gate ──
        // Held reminders are left completely untouched: no status change, no
        // note appended. That is what makes an hourly sweep idempotent — the
        // other 23 hours are pure reads.
        if (respectLocalHour && hourInTimezone(now, locale.timezone) !== REMINDER_SEND_HOUR) {
          heldForLocalTime++;
          continue;
        }

        // A redeploy can restart the process inside the same local hour.
        // Reminders that succeeded are already 'sent'; this covers the ones
        // that stay 'pending' because the customer has no email and no phone.
        const lastAttempt = reminder.lastAttemptAt ? new Date(reminder.lastAttemptAt).getTime() : 0;
        if (respectLocalHour && now.getTime() - lastAttempt < REATTEMPT_COOLDOWN_MS) {
          heldForLocalTime++;
          continue;
        }

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
          reminderType: reminder.type,
          locale
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
            lastAttemptAt: now,
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
            lastAttemptAt: now,
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
          lastAttemptAt: now,
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
      heldForLocalTime,
      smsConfigured: isSmsConfigured(),
      durationMs: duration
    });

    return { processed: dueReminders.length, emailSent, smsSent, skipped, failed, heldForLocalTime };
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
  // Every half hour, in UTC — each garage is served during the hour that reads
  // 09:00 in its own timezone.
  //
  // :00 and :30, not just :00, because several zones are offset by a half hour
  // (India +5:30, Adelaide +9:30, Newfoundland -3:30, Kathmandu +5:45). On a
  // strictly hourly schedule the first UTC tick that lands inside India's 09:00
  // hour is 04:00 UTC — which is already 09:30 IST, quietly moving every Indian
  // garage's reminders half an hour later than the 'Asia/Kolkata' 09:00 cron
  // this replaced. 03:30 UTC is exactly 09:00 IST.
  //
  // The extra tick cannot double-send: a reminder that went out is already
  // 'sent' and no longer matches the query, and one that couldn't be sent is
  // held by the re-attempt cooldown.
  cron.schedule('0,30 * * * *', () => {
    processServiceReminders({ respectLocalHour: true });
  }, {
    timezone: 'UTC'
  });
  log.info('Cron job registered: Service reminders (every 30m UTC, sent at 09:00 garage-local)');

  // Every Sunday at 2:00 AM UTC — Cleanup old reminders.
  // Housekeeping only, never customer-facing, so one global time is fine.
  cron.schedule('0 2 * * 0', () => {
    cleanupOldReminders();
  }, {
    timezone: 'UTC'
  });
  log.info('Cron job registered: Reminder cleanup (Sunday 2:00 AM UTC)');

  // One run on startup (after 10s so the DB is ready) so a deploy landing
  // inside a garage's 09:00 hour still serves it. It respects the local-hour
  // gate and the cooldown, so it is a no-op the rest of the time and a
  // redeploy can never double-send. A garage whose 09:00 was missed entirely
  // is picked up the next day — reminders fire up to 7 days before the due
  // date, so a one-day slip is harmless.
  setTimeout(() => {
    log.info('Running initial reminder check on startup...');
    processServiceReminders({ respectLocalHour: true });
  }, 10000);
};
