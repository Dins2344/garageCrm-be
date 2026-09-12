import { z } from 'zod';
import { serviceReminders } from '../config/schema';
import { REMINDER_TYPES, REMINDER_STATUSES } from '../types/domain';
import { optionalString, numberField, idField } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

export { serviceReminders };
export type ServiceReminderRow = typeof serviceReminders.$inferSelect;
export type NewServiceReminder = typeof serviceReminders.$inferInsert;

export const reminderStatusField = z.enum(REMINDER_STATUSES, { error: `Status must be one of: ${REMINDER_STATUSES.join(', ')}` });

export const createReminderSchema = z.object({
  vehicle: idField('Vehicle is required'),
  customer: idField('Customer is required'),
  jobCard: z.string().nullable().default(null),
  type: z.enum(REMINDER_TYPES, { error: `Reminder type must be one of: ${REMINDER_TYPES.join(', ')}` }).default('periodic_service'),
  nextServiceDate: z.coerce.date({ error: 'Next service date is required' }),
  nextServiceKm: numberField('Next service km must be a number').default(0),
  notes: optionalString(),
  status: reminderStatusField.default('pending')
});

export const reminderToApi = (row: object): ApiObject => serializeRow(row);
