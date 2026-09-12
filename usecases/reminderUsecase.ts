import { and, asc, count, eq, lte } from 'drizzle-orm';
import { db } from '../config/db';
import { serviceReminders, createReminderSchema, reminderStatusField, reminderToApi } from '../models/ServiceReminder';
import { garages } from '../models/Garage';
import { vehicles } from '../models/Vehicle';
import { customers } from '../models/Customer';
import type { DeliveredJobCard } from './jobCardUsecase';
import { runSchema } from '../utils/validation';
import { pagination } from '../utils/query';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('ReminderUsecase');

const LIST_WITH = {
  vehicle: { columns: { _id: true, licensePlate: true, make: true, model: true } },
  customer: { columns: { _id: true, name: true, phone: true } }
} as const;

interface ListInput {
  garageId: string;
  status?: string;
  page?: number | string;
  limit?: number | string;
}

export const getRemindersList = async ({ garageId, status, page = 1, limit = 20 }: ListInput) => {
  const paging = pagination(page, limit);
  const where = and(
    eq(serviceReminders.garageId, garageId),
    status ? eq(serviceReminders.status, status) : undefined
  );

  const [{ total }] = await db.select({ total: count() }).from(serviceReminders).where(where);
  const rows = await db.query.serviceReminders.findMany({
    with: LIST_WITH,
    where,
    orderBy: [asc(serviceReminders.nextServiceDate)],
    offset: paging.offset,
    limit: paging.limit
  });

  return { reminders: rows.map(reminderToApi), total };
};

interface UpcomingInput {
  garageId: string;
  days?: number;
}

export const getUpcomingReminders = async ({ garageId, days = 30 }: UpcomingInput): Promise<ApiObject[]> => {
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  const rows = await db.query.serviceReminders.findMany({
    with: LIST_WITH,
    where: and(
      eq(serviceReminders.garageId, garageId),
      eq(serviceReminders.status, 'pending'),
      lte(serviceReminders.nextServiceDate, futureDate)
    ),
    orderBy: [asc(serviceReminders.nextServiceDate)],
    limit: 50
  });

  // Classify as overdue or upcoming
  return rows.map(r => ({
    ...reminderToApi(r),
    isOverdue: new Date(r.nextServiceDate) < now
  }));
};

interface CreateInput {
  reminderData: Record<string, unknown>;
  garageId: string;
}

export const createReminder = async ({ reminderData, garageId }: CreateInput): Promise<ApiObject> => {
  const { vehicle, customer, jobCard, ...input } = runSchema(createReminderSchema, reminderData);

  // Both must belong to this garage; the foreign keys only prove they exist.
  const [vehicleRow, customerRow] = await Promise.all([
    db.query.vehicles.findFirst({ columns: { _id: true }, where: and(eq(vehicles._id, vehicle), eq(vehicles.garageId, garageId)) }),
    db.query.customers.findFirst({ columns: { _id: true }, where: and(eq(customers._id, customer), eq(customers.garageId, garageId)) })
  ]);
  if (!vehicleRow) throw new HttpError('Vehicle not found', 404);
  if (!customerRow) throw new HttpError('Customer not found', 404);

  const [reminder] = await db.insert(serviceReminders).values({
    ...input,
    vehicleId: vehicle,
    customerId: customer,
    jobCardId: jobCard,
    garageId
  }).returning();

  log.info('Service reminder created', { reminderId: reminder._id, vehicleId: reminder.vehicleId });
  return reminderToApi(reminder);
};

interface AutoCreateInput {
  jobCard: DeliveredJobCard;
  garageId: string;
}

export const autoCreateFromDelivery = async ({ jobCard, garageId }: AutoCreateInput): Promise<ApiObject> => {
  // Get garage settings for reminder interval
  const garage = await db.query.garages.findFirst({ columns: { settings: true }, where: eq(garages._id, garageId) });
  const reminderDays = garage?.settings?.serviceReminderDays || 180; // 6 months default

  const nextServiceDate = new Date();
  nextServiceDate.setDate(nextServiceDate.getDate() + reminderDays);

  const [reminder] = await db.insert(serviceReminders).values({
    vehicleId: jobCard.vehicleId,
    customerId: jobCard.customerId,
    garageId,
    jobCardId: jobCard._id,
    type: jobCard.serviceType,
    nextServiceDate,
    notes: `Auto-created after Job Card ${jobCard.jobCardNumber} delivery`
  }).returning();

  log.info('Auto service reminder created', {
    reminderId: reminder._id,
    jobCardNumber: jobCard.jobCardNumber,
    nextServiceDate: nextServiceDate.toISOString()
  });

  return reminderToApi(reminder);
};

interface UpdateStatusInput {
  reminderId: string;
  garageId: string;
  status: string;
}

export const updateReminderStatus = async ({ reminderId, garageId, status }: UpdateStatusInput): Promise<ApiObject> => {
  const nextStatus = runSchema(reminderStatusField, status);
  const [reminder] = await db.update(serviceReminders)
    .set({ status: nextStatus, ...(nextStatus === 'sent' ? { reminderSentAt: new Date() } : {}) })
    .where(and(eq(serviceReminders._id, reminderId), eq(serviceReminders.garageId, garageId)))
    .returning();
  if (!reminder) {
    throw new HttpError('Reminder not found', 404);
  }
  return reminderToApi(reminder);
};

interface RemoveInput {
  reminderId: string;
  garageId: string;
}

export const removeReminder = async ({ reminderId, garageId }: RemoveInput): Promise<true> => {
  const deleted = await db.delete(serviceReminders)
    .where(and(eq(serviceReminders._id, reminderId), eq(serviceReminders.garageId, garageId)))
    .returning({ _id: serviceReminders._id });
  if (deleted.length === 0) {
    throw new HttpError('Reminder not found', 404);
  }
  return true;
};
