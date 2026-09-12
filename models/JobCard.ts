import { z } from 'zod';
import {
  jobCards, Complaint, JobCardPhoto, StatusHistoryEntry, Estimation, EstimationPart, EstimationLabor
} from '../config/schema';
import { SERVICE_TYPES, COMPLAINT_PRIORITIES, JOB_STATUSES } from '../types/domain';
import { requiredString, optionalString, numberField, boundedNumber, nullableDate, idField } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

export { jobCards };
export type JobCardRow = typeof jobCards.$inferSelect;
export type NewJobCard = typeof jobCards.$inferInsert;
export type {
  Complaint as IComplaint,
  JobCardPhoto as IJobCardPhoto,
  StatusHistoryEntry as IStatusHistoryEntry,
  Estimation as IEstimation,
  EstimationPart as IEstimationPart,
  EstimationLabor as IEstimationLabor
};

/**
 * A `statusHistory` entry, timestamped at creation the way the embedded
 * subdocument's `changedAt: Date.now` default did. Stored as an ISO string
 * inside the JSONB column.
 */
export const historyEntry = (status: string, changedBy: string | null, notes = ''): StatusHistoryEntry => ({
  status,
  changedBy,
  changedAt: new Date().toISOString(),
  notes
});

const complaintSchema = z.object({
  description: requiredString('Complaint description is required'),
  priority: z.enum(COMPLAINT_PRIORITIES, { error: `Priority must be one of: ${COMPLAINT_PRIORITIES.join(', ')}` }).default('medium')
});

const photoSchema = z.object({
  url: optionalString(),
  caption: optionalString(),
  uploadedAt: z.string().default(() => new Date().toISOString()),
  uploadedBy: z.string().nullable().default(null)
});

const serviceTypeField = z.enum(SERVICE_TYPES, { error: `Service type must be one of: ${SERVICE_TYPES.join(', ')}` });
const statusField = z.enum(JOB_STATUSES, { error: `Status must be one of: ${JOB_STATUSES.join(', ')}` });
const nullableId = z.preprocess(v => (v === '' ? null : v), z.string().nullable());

// 9,999,999 km is far beyond any real vehicle — a value above this is a
// data-entry error (e.g. digits accidentally entered twice), not a genuine
// reading. Enforced here so no client can bypass it.
const odometerField = boundedNumber('Odometer reading is required', {
  min: [0, 'Odometer reading cannot be negative'],
  max: [9999999, 'Odometer reading looks too large — please check the value']
});

export const createJobCardSchema = z.object({
  serviceType: serviceTypeField,
  vehicle: idField('Vehicle is required'),
  customer: idField('Customer is required'),
  complaints: z.array(complaintSchema).default([]),
  photos: z.array(photoSchema).default([]),
  assignedMechanic: nullableId.default(null),
  assignedAdvisor: nullableId.default(null),
  odometerAtIntake: odometerField,
  expectedDeliveryDate: nullableDate().default(null),
  internalNotes: optionalString()
});

/**
 * Everything a PUT may change. `status` transitions and the estimation are
 * handled by the usecase, which also strips the `statusNotes` companion field
 * before writing — it is a message for the history entry, not a column.
 */
export const updateJobCardSchema = z.object({
  serviceType: serviceTypeField.optional(),
  complaints: z.array(complaintSchema).optional(),
  photos: z.array(photoSchema).optional(),
  assignedMechanic: nullableId.optional(),
  assignedAdvisor: nullableId.optional(),
  status: statusField.optional(),
  statusNotes: z.string().optional(),
  odometerAtIntake: odometerField.optional(),
  expectedDeliveryDate: nullableDate().optional(),
  actualDeliveryDate: nullableDate().optional(),
  internalNotes: z.string().trim().optional()
});

const estimationPartSchema = z.object({
  inventoryItem: nullableId.default(null),
  partName: optionalString(),
  quantity: numberField('Part quantity must be a number').default(1),
  unitPrice: numberField('Part price must be a number').default(0)
});

const estimationLaborSchema = z.object({
  description: optionalString(),
  hours: numberField('Labour hours must be a number').default(1),
  ratePerHour: numberField('Labour rate must be a number').default(0)
});

export const estimationInputSchema = z.object({
  parts: z.array(estimationPartSchema).optional(),
  labor: z.array(estimationLaborSchema).optional(),
  discount: numberField('Discount must be a number').optional(),
  taxRate: numberField('Tax rate must be a number').optional()
});

/**
 * Two of the JSONB payloads carry user references that `populate()` used to
 * resolve: `estimation.parts[].inventoryItem` and `statusHistory[].changedBy`.
 * The detail query looks those up in one `inArray` each and passes the maps
 * here so the entries carry the same `{ _id, name }` / `{ _id, partName,
 * partNumber }` objects they always did.
 */
export interface JobCardLookups {
  usersById?: Map<string, ApiObject>;
  inventoryById?: Map<string, ApiObject>;
}

export const jobCardToApi = (row: object, lookups: JobCardLookups = {}): ApiObject => {
  const out = serializeRow(row);

  if (lookups.usersById && Array.isArray(out.statusHistory)) {
    out.statusHistory = (out.statusHistory as StatusHistoryEntry[]).map(entry => ({
      ...entry,
      changedBy: (entry.changedBy && lookups.usersById!.get(entry.changedBy)) || entry.changedBy
    }));
  }

  const estimation = out.estimation as Estimation | undefined;
  if (lookups.inventoryById && estimation && Array.isArray(estimation.parts)) {
    out.estimation = {
      ...estimation,
      parts: estimation.parts.map(part => ({
        ...part,
        inventoryItem: (part.inventoryItem && lookups.inventoryById!.get(part.inventoryItem)) || part.inventoryItem
      }))
    };
  }

  return out;
};

/**
 * The list shape: Mongoose selected out `estimation.parts`,
 * `estimation.labor` and `statusHistory` (and `photos` on the vehicle history
 * endpoint) to keep list payloads small. The totals stay.
 */
export const jobCardSummaryToApi = (row: object): ApiObject => {
  const out = serializeRow(row);
  delete out.statusHistory;
  delete out.photos;
  const estimation = out.estimation as Partial<Estimation> | undefined;
  if (estimation) {
    const { parts: _parts, labor: _labor, ...totals } = estimation;
    out.estimation = totals;
  }
  return out;
};
