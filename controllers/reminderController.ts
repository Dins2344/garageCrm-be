import { Request, Response, NextFunction } from 'express';
import * as reminderUsecase from '../usecases/reminderUsecase';
import { processServiceReminders } from '../services/cronScheduler';
import logger from '../utils/logger';
const log = logger.child('ReminderController');

// @desc    Get all service reminders
// @route   GET /api/reminders
export const getReminders = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
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
  } catch (error) {
    log.error('Failed to fetch reminders', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get upcoming / overdue reminders
// @route   GET /api/reminders/upcoming
export const getUpcoming = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const days = parseInt(String(req.query.days), 10) || 30;
    const garageId = req.garageId!;
    log.info('Fetching upcoming reminders', { garageId, days });
    const reminders = await reminderUsecase.getUpcomingReminders({
      garageId,
      days
    });
    log.info('Upcoming reminders fetched', { garageId, count: reminders.length });
    res.status(200).json({ success: true, count: reminders.length, data: reminders });
  } catch (error) {
    log.error('Failed to fetch upcoming reminders', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Create service reminder manually
// @route   POST /api/reminders
export const createReminder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.garageId!;
    log.info('Creating service reminder', { garageId, vehicleId: req.body.vehicle });
    const reminder = await reminderUsecase.createReminder({
      reminderData: req.body,
      garageId
    });
    log.info('Service reminder created', { reminderId: reminder._id, garageId });
    res.status(201).json({ success: true, data: reminder });
  } catch (error) {
    log.error('Failed to create reminder', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update reminder status (mark sent, completed, dismissed)
// @route   PATCH /api/reminders/:id
export const updateStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
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
  } catch (error) {
    log.error('Failed to update reminder status', { reminderId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Delete reminder
// @route   DELETE /api/reminders/:id
export const deleteReminder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.garageId!;
    log.info('Deleting reminder', { reminderId: id, garageId });
    await reminderUsecase.removeReminder({
      reminderId: id,
      garageId
    });
    log.info('Reminder deleted', { reminderId: id, garageId });
    res.status(200).json({ success: true, message: 'Reminder deleted' });
  } catch (error) {
    log.error('Failed to delete reminder', { reminderId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Manually trigger the reminder cron job (admin/owner only)
// @route   POST /api/reminders/trigger-cron
export const triggerCron = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('Manual cron trigger initiated', { triggeredBy: req.user!._id, role: req.user!.role });
    const result = await processServiceReminders();
    log.info('Manual cron trigger completed', { triggeredBy: req.user!._id, result });
    res.status(200).json({ success: true, message: 'Reminder cron triggered manually', data: result });
  } catch (error) {
    log.error('Manual cron trigger failed', { triggeredBy: req.user?._id, error: (error as Error).message });
    next(error);
  }
};
