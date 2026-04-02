const cron = require('node-cron');
const ServiceReminder = require('../models/ServiceReminder');
const Garage = require('../models/Garage');
const { sendServiceReminder } = require('../services/emailService');
const logger = require('../utils/logger');
const log = logger.child('CronScheduler');

// ───────────────────────────────────────────────
// Job 1: Process Service Reminders
// Runs every day at 9:00 AM server time
// Finds all pending reminders due within the next 7 days
// Sends email notifications and marks them as 'sent'
// ───────────────────────────────────────────────
const processServiceReminders = async () => {
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
      .lean();

    if (dueReminders.length === 0) {
      log.info('Cron: No pending reminders found');
      return { processed: 0, sent: 0, skipped: 0, failed: 0 };
    }

    log.info(`Cron: Found ${dueReminders.length} reminders to process`);

    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const reminder of dueReminders) {
      try {
        const result = await sendServiceReminder({
          customerName: reminder.customer?.name || 'Customer',
          customerEmail: reminder.customer?.email,
          vehiclePlate: reminder.vehicle?.licensePlate || 'Unknown',
          vehicleMake: reminder.vehicle?.make || '',
          vehicleModel: reminder.vehicle?.model || '',
          garageName: reminder.garage?.name || 'GarageFlow',
          garagePhone: reminder.garage?.phone || '',
          nextServiceDate: reminder.nextServiceDate,
          reminderType: reminder.type
        });

        if (result.skipped) {
          // No email for this customer — mark as sent anyway so we don't retry forever
          await ServiceReminder.findByIdAndUpdate(reminder._id, {
            status: 'sent',
            reminderSentAt: now,
            notes: (reminder.notes || '') + '\n[Cron] Skipped: no customer email'
          });
          skipped++;
          continue;
        }

        // Successfully sent — update status
        await ServiceReminder.findByIdAndUpdate(reminder._id, {
          status: 'sent',
          reminderSentAt: now,
          notes: (reminder.notes || '') +
            `\n[Cron] Email sent to ${reminder.customer?.email} at ${now.toISOString()}` +
            (result.previewUrl ? `\n[Ethereal Preview] ${result.previewUrl}` : '')
        });

        sent++;

        log.info('Cron: Reminder sent', {
          reminderId: reminder._id,
          customer: reminder.customer?.name,
          vehicle: reminder.vehicle?.licensePlate,
          previewUrl: result.previewUrl || null
        });
      } catch (err) {
        failed++;
        log.error('Cron: Failed to process reminder', {
          reminderId: reminder._id,
          error: err.message
        });

        // Add error note but don't change status — will retry next run
        await ServiceReminder.findByIdAndUpdate(reminder._id, {
          notes: (reminder.notes || '') + `\n[Cron Error] ${now.toISOString()}: ${err.message}`
        });
      }
    }

    const duration = Date.now() - jobStart;
    log.info('Cron: Service reminder processing complete', {
      total: dueReminders.length,
      sent,
      skipped,
      failed,
      durationMs: duration
    });

    return { processed: dueReminders.length, sent, skipped, failed };
  } catch (err) {
    log.error('Cron: Fatal error in reminder processing', { error: err.message, stack: err.stack });
    return { error: err.message };
  }
};

// ───────────────────────────────────────────────
// Job 2: Clean up old dismissed/completed reminders
// Runs every Sunday at 2:00 AM
// Removes reminders completed/dismissed more than 90 days ago
// ───────────────────────────────────────────────
const cleanupOldReminders = async () => {
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
    log.error('Cron: Cleanup error', { error: err.message });
    return { error: err.message };
  }
};

// ───────────────────────────────────────────────
// Scheduler Bootstrap
// ───────────────────────────────────────────────
const startScheduler = () => {
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

module.exports = {
  startScheduler,
  processServiceReminders,
  cleanupOldReminders
};
