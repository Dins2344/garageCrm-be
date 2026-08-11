import { Types } from 'mongoose';
import ServiceReminder, { IServiceReminder } from '../models/ServiceReminder';
import Garage from '../models/Garage';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('ReminderUsecase');

interface ListInput {
  garageId: Types.ObjectId | string;
  status?: string;
  page?: number | string;
  limit?: number | string;
}

export const getRemindersList = async ({ garageId, status, page = 1, limit = 20 }: ListInput) => {
  const query: Record<string, unknown> = { garage: garageId };
  if (status) query.status = status;

  const total = await ServiceReminder.countDocuments(query);
  const reminders = await ServiceReminder.find(query)
    .populate('vehicle', 'licensePlate make model')
    .populate('customer', 'name phone')
    .sort('nextServiceDate')
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  return { reminders, total };
};

interface UpcomingInput {
  garageId: Types.ObjectId | string;
  days?: number;
}

export const getUpcomingReminders = async ({ garageId, days = 30 }: UpcomingInput) => {
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

interface CreateInput {
  reminderData: Partial<IServiceReminder>;
  garageId: Types.ObjectId | string;
}

export const createReminder = async ({ reminderData, garageId }: CreateInput) => {
  const dataWithGarage = { ...reminderData, garage: garageId };
  const reminder = await ServiceReminder.create(dataWithGarage);
  log.info('Service reminder created', { reminderId: reminder._id, vehicleId: reminder.vehicle });
  return reminder;
};

interface DeliveredJobCard {
  _id: Types.ObjectId;
  vehicle: Types.ObjectId | { _id: Types.ObjectId };
  customer: Types.ObjectId | { _id: Types.ObjectId };
  serviceType: string;
  jobCardNumber: string;
}

interface AutoCreateInput {
  jobCard: DeliveredJobCard;
  garageId: Types.ObjectId | string;
}

export const autoCreateFromDelivery = async ({ jobCard, garageId }: AutoCreateInput) => {
  // Get garage settings for reminder interval
  const garage = await Garage.findById(garageId).lean();
  const reminderDays = garage?.settings?.serviceReminderDays || 180; // 6 months default

  const nextServiceDate = new Date();
  nextServiceDate.setDate(nextServiceDate.getDate() + reminderDays);

  const vehicleId = '_id' in jobCard.vehicle ? jobCard.vehicle._id : jobCard.vehicle;
  const customerId = '_id' in jobCard.customer ? jobCard.customer._id : jobCard.customer;

  const reminder = await ServiceReminder.create({
    vehicle: vehicleId,
    customer: customerId,
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

interface UpdateStatusInput {
  reminderId: string;
  garageId: Types.ObjectId | string;
  status: string;
}

export const updateReminderStatus = async ({ reminderId, garageId, status }: UpdateStatusInput) => {
  const reminder = await ServiceReminder.findOneAndUpdate(
    { _id: reminderId, garage: garageId },
    { status, ...(status === 'sent' ? { reminderSentAt: new Date() } : {}) },
    { new: true }
  );
  if (!reminder) {
    throw new HttpError('Reminder not found', 404);
  }
  return reminder;
};

interface RemoveInput {
  reminderId: string;
  garageId: Types.ObjectId | string;
}

export const removeReminder = async ({ reminderId, garageId }: RemoveInput): Promise<true> => {
  const reminder = await ServiceReminder.findOneAndDelete({ _id: reminderId, garage: garageId });
  if (!reminder) {
    throw new HttpError('Reminder not found', 404);
  }
  return true;
};
