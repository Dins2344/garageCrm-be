const reminderUsecase = require('../usecases/reminderUsecase');
const logger = require('../utils/logger');
const log = logger.child('ReminderController');

// @desc    Get all service reminders
// @route   GET /api/reminders
exports.getReminders = async (req, res, next) => {
  try {
    const { status, page, limit } = req.query;
    const { reminders, total } = await reminderUsecase.getRemindersList({
      garageId: req.user.garage._id,
      status,
      page,
      limit
    });
    res.status(200).json({ success: true, count: reminders.length, total, data: reminders });
  } catch (error) {
    next(error);
  }
};

// @desc    Get upcoming / overdue reminders
// @route   GET /api/reminders/upcoming
exports.getUpcoming = async (req, res, next) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const reminders = await reminderUsecase.getUpcomingReminders({
      garageId: req.user.garage._id,
      days
    });
    res.status(200).json({ success: true, count: reminders.length, data: reminders });
  } catch (error) {
    next(error);
  }
};

// @desc    Create service reminder manually
// @route   POST /api/reminders
exports.createReminder = async (req, res, next) => {
  try {
    const reminder = await reminderUsecase.createReminder({
      reminderData: req.body,
      garageId: req.user.garage._id
    });
    res.status(201).json({ success: true, data: reminder });
  } catch (error) {
    next(error);
  }
};

// @desc    Update reminder status (mark sent, completed, dismissed)
// @route   PATCH /api/reminders/:id
exports.updateStatus = async (req, res, next) => {
  try {
    const reminder = await reminderUsecase.updateReminderStatus({
      reminderId: req.params.id,
      garageId: req.user.garage._id,
      status: req.body.status
    });
    res.status(200).json({ success: true, data: reminder });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete reminder
// @route   DELETE /api/reminders/:id
exports.deleteReminder = async (req, res, next) => {
  try {
    await reminderUsecase.removeReminder({
      reminderId: req.params.id,
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, message: 'Reminder deleted' });
  } catch (error) {
    next(error);
  }
};
