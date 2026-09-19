import { Request, Response } from 'express';
import * as reminderUsecase from '../usecases/reminderUsecase';
import { processServiceReminders } from '../services/cronScheduler';
import logger from '../utils/logger';
const log = logger.child('ReminderController');

// @desc    Get all service reminders
// @route   GET /api/reminders
export const getReminders = async (req: Request, res: Response): Promise<void> => {
  const { status, page, limit } = req.query as Record<string, string | undefined>;
  const garageId = req.garageId!;
  log.info('Fetching reminders list', { garageId, status, page, limit });
  const { reminders, total } = await reminderUsecase.getRemindersList({
    garageId,
    status,
    page,
    limit
  });
  log.info('Reminders list fetched', { garageId, count: reminders.length, total });
  res.status(200).json({ success: true, count: reminders.length, total, data: reminders });
};

// @desc    Get upcoming / overdue reminders
// @route   GET /api/reminders/upcoming
export const getUpcoming = async (req: Request, res: Response): Promise<void> => {
  const days = parseInt(String(req.query.days), 10) || 30;
  const garageId = req.garageId!;
  log.info('Fetching upcoming reminders', { garageId, days });
  const reminders = await reminderUsecase.getUpcomingReminders({
    garageId,
    days
  });
  log.info('Upcoming reminders fetched', { garageId, count: reminders.length });
  res.status(200).json({ success: true, count: reminders.length, data: reminders });
};

// @desc    Create service reminder manually
// @route   POST /api/reminders
export const createReminder = async (req: Request, res: Response): Promise<void> => {
  const garageId = req.garageId!;
  log.info('Creating service reminder', { garageId, vehicleId: req.body.vehicle });
  const reminder = await reminderUsecase.createReminder({
    reminderData: req.body,
    garageId
  });
  log.info('Service reminder created', { reminderId: reminder._id, garageId });
  res.status(201).json({ success: true, data: reminder });
};

// @desc    Update reminder status (mark sent, completed, dismissed)
// @route   PATCH /api/reminders/:id
export const updateStatus = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const garageId = req.garageId!;
  log.info('Updating reminder status', { reminderId: id, garageId, status: req.body.status });
  const reminder = await reminderUsecase.updateReminderStatus({
    reminderId: id,
    garageId,
    status: req.body.status
  });
  log.info('Reminder status updated', { reminderId: id, newStatus: reminder.status });
  res.status(200).json({ success: true, data: reminder });
};

// @desc    Delete reminder
// @route   DELETE /api/reminders/:id
export const deleteReminder = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const garageId = req.garageId!;
  log.info('Deleting reminder', { reminderId: id, garageId });
  await reminderUsecase.removeReminder({
    reminderId: id,
    garageId
  });
  log.info('Reminder deleted', { reminderId: id, garageId });
  res.status(200).json({ success: true, message: 'Reminder deleted' });
};

// @desc    Manually trigger the reminder cron job (admin/owner only)
// @route   POST /api/reminders/trigger-cron
export const triggerCron = async (req: Request, res: Response): Promise<void> => {
  log.info('Manual cron trigger initiated', { triggeredBy: req.user!._id, role: req.user!.role });
  const result = await processServiceReminders();
  log.info('Manual cron trigger completed', { triggeredBy: req.user!._id, result });
  res.status(200).json({ success: true, message: 'Reminder cron triggered manually', data: result });
};
