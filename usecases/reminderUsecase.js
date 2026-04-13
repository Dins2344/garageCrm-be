const ServiceReminder = require('../models/ServiceReminder');
const Garage = require('../models/Garage');
const logger = require('../utils/logger');
const log = logger.child('ReminderUsecase');

exports.getRemindersList = async ({ garageId, status, page = 1, limit = 20 }) => {
  let query = { garage: garageId };
  if (status) query.status = status;

  const total = await ServiceReminder.countDocuments(query);
  const reminders = await ServiceReminder.find(query)
    .populate('vehicle', 'licensePlate make model')
    .populate('customer', 'name phone')
    .sort('nextServiceDate')
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return { reminders, total };
};

exports.getUpcomingReminders = async ({ garageId, days = 30 }) => {
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  const reminders = await ServiceReminder.find({
    garage: garageId,
    status: 'pending',
    nextServiceDate: { $lte: futureDate }
  })
    .populate('vehicle', 'licensePlate make model')
    .populate('customer', 'name phone')
    .sort('nextServiceDate')
    .limit(50)
    .lean();

  // Classify as overdue or upcoming
  return reminders.map(r => ({
    ...r,
    isOverdue: new Date(r.nextServiceDate) < now
  }));
};

exports.createReminder = async ({ reminderData, garageId }) => {
  reminderData.garage = garageId;
  const reminder = await ServiceReminder.create(reminderData);
  log.info('Service reminder created', { reminderId: reminder._id, vehicleId: reminder.vehicle });
  return reminder;
};

exports.autoCreateFromDelivery = async ({ jobCard, garageId }) => {
  // Get garage settings for reminder interval
  const garage = await Garage.findById(garageId).lean();
  const reminderDays = garage?.settings?.serviceReminderDays || 180; // 6 months default

  const nextServiceDate = new Date();
  nextServiceDate.setDate(nextServiceDate.getDate() + reminderDays);

  const reminder = await ServiceReminder.create({
    vehicle: jobCard.vehicle?._id || jobCard.vehicle,
    customer: jobCard.customer?._id || jobCard.customer,
    garage: garageId,
    jobCard: jobCard._id,
    type: jobCard.serviceType,
    nextServiceDate,
    notes: `Auto-created after Job Card ${jobCard.jobCardNumber} delivery`
  });

  log.info('Auto service reminder created', {
    reminderId: reminder._id,
    jobCardNumber: jobCard.jobCardNumber,
    nextServiceDate: nextServiceDate.toISOString()
  });

  return reminder;
};

exports.updateReminderStatus = async ({ reminderId, garageId, status }) => {
  const reminder = await ServiceReminder.findOneAndUpdate(
    { _id: reminderId, garage: garageId },
    { status, ...(status === 'sent' ? { reminderSentAt: new Date() } : {}) },
    { new: true }
  );
  if (!reminder) {
    const err = new Error('Reminder not found');
    err.statusCode = 404;
    throw err;
  }
  return reminder;
};

exports.removeReminder = async ({ reminderId, garageId }) => {
  const reminder = await ServiceReminder.findOneAndDelete({ _id: reminderId, garage: garageId });
  if (!reminder) {
    const err = new Error('Reminder not found');
    err.statusCode = 404;
    throw err;
  }
  return true;
};
