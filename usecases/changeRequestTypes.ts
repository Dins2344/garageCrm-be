/**
 * The change-request types. Each entry says what staff submit, what the
 * request is about, whether it can happen right now, and how an approval
 * carries it out — always through the usecase an owner's direct action uses,
 * so the timeline and every side effect come out identical.
 *
 * Adding a type: one entry here, its value in CHANGE_REQUEST_TYPES
 * (types/domain.ts, mirrored in both clients), and a "Request ..." button where
 * the action lives in each client. No migration, no new endpoint.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../config/db';
import { jobCards, JobCardRow, ODOMETER_MAX } from '../models/JobCard';
import { invoices, InvoiceRow } from '../models/Invoice';
import { ChangeRequestTargetType, ChangeRequestType, JobStatus, Role, TERMINAL_JOB_STATUSES } from '../types/domain';
import { HttpError } from '../utils/httpError';
import { isObjectIdHex } from '../utils/ids';
import { boundedNumber, requiredString } from '../utils/validation';
import { updateJobCardProgress } from './jobCardUsecase';
import { removeInvoice } from './invoiceUsecase';

export interface ApplyContext {
  garageId: string;
  approverId: string;
  approverRole: Role;
  requesterName: string;
}

export interface RequestTypeHandler<T, P> {
  targetType: ChangeRequestTargetType;
  /** Title of the notification owners and admins receive. */
  title: string;
  /** What staff submit. Run through `runSchema`, so a failure is a 400 with the field's message. */
  payloadSchema: z.ZodType<P>;
  /** The target in this garage; 404 when it is not there. */
  load: (garageId: string, targetId: string) => Promise<T>;
  /** The job card or invoice number, kept on the request. */
  label: (target: T) => string;
  /** Throws when the change cannot happen now. Runs at raise and again at approval. */
  check: (target: T, payload: P) => void;
  /** Values recorded at raise time, stored with the payload. */
  snapshot: (target: T) => Record<string, unknown>;
  apply: (target: T, payload: P, ctx: ApplyContext) => Promise<void>;
  /** Completes "approved your request to ...": "cancel JC-...". */
  describe: (label: string) => string;
  /** Completes "Ravi asked to ...", with the detail an approver needs. */
  summary: (label: string, payload: P) => string;
}

const loadJobCard = async (garageId: string, id: string): Promise<JobCardRow> => {
  const row = isObjectIdHex(id)
    ? await db.query.jobCards.findFirst({ where: and(eq(jobCards._id, id), eq(jobCards.garageId, garageId)) })
    : undefined;
  if (!row) throw new HttpError('Job card not found', 404);
  return row;
};

const loadInvoice = async (garageId: string, id: string): Promise<InvoiceRow> => {
  const row = isObjectIdHex(id)
    ? await db.query.invoices.findFirst({ where: and(eq(invoices._id, id), eq(invoices.garageId, garageId)) })
    : undefined;
  if (!row) throw new HttpError('Invoice not found', 404);
  return row;
};

const reasonField = requiredString('Reason is required').max(500, { error: 'Reason cannot exceed 500 characters' });

interface OdometerPayload {
  odometerAtIntake: number;
  remarks: string;
  previousOdometer?: number;
}

interface ReasonPayload {
  reason: string;
}

const odometerCorrection: RequestTypeHandler<JobCardRow, OdometerPayload> = {
  targetType: 'job_card',
  title: 'Odometer correction requested',
  payloadSchema: z.object({
    odometerAtIntake: boundedNumber('Odometer must be a number', { min: [0, 'Odometer cannot be negative'], max: ODOMETER_MAX })
      .refine(Number.isInteger, { error: 'Odometer must be a whole number' }),
    // 400, not the job card's 500: approval appends "(requested by <name>)".
    remarks: requiredString('Remarks are required').max(400, { error: 'Remarks cannot exceed 400 characters' })
  }),
  load: loadJobCard,
  label: jc => jc.jobCardNumber,
  check: (jc, p) => {
    // Only present once raised: at approval the reading must still be the one the request replaces.
    if (p.previousOdometer !== undefined && p.previousOdometer !== jc.odometerAtIntake) {
      throw new HttpError(
        `The odometer has changed to ${jc.odometerAtIntake} km since this request was raised. Reject it and ask for a new one.`,
        409
      );
    }
    if (p.odometerAtIntake === jc.odometerAtIntake) {
      throw new HttpError('The new reading is the same as the recorded one.', 400);
    }
  },
  snapshot: jc => ({ previousOdometer: jc.odometerAtIntake }),
  apply: async (jc, p, ctx) => {
    await updateJobCardProgress({
      jobCardId: jc._id,
      garageId: ctx.garageId,
      userId: ctx.approverId,
      role: ctx.approverRole,
      // ponytail: sliced to the job card's 500-character limit; only a very long name gets cut.
      updateData: { odometerAtIntake: p.odometerAtIntake, odometerRemarks: `${p.remarks} (requested by ${ctx.requesterName})`.slice(0, 500) }
    });
  },
  describe: label => `correct the odometer on ${label}`,
  summary: (label, p) => `correct the odometer on ${label} from ${p.previousOdometer} km to ${p.odometerAtIntake} km`
};

const jobCardCancellation: RequestTypeHandler<JobCardRow, ReasonPayload> = {
  targetType: 'job_card',
  title: 'Cancellation requested',
  payloadSchema: z.object({ reason: reasonField }),
  load: loadJobCard,
  label: jc => jc.jobCardNumber,
  check: jc => {
    if (TERMINAL_JOB_STATUSES.includes(jc.status as JobStatus)) {
      throw new HttpError(`This job card is already ${jc.status} and cannot be cancelled.`, 400);
    }
  },
  snapshot: () => ({}),
  apply: async (jc, p, ctx) => {
    await updateJobCardProgress({
      jobCardId: jc._id,
      garageId: ctx.garageId,
      userId: ctx.approverId,
      role: ctx.approverRole,
      updateData: { status: 'cancelled', statusNotes: `Cancelled at ${ctx.requesterName}'s request: ${p.reason}` }
    });
  },
  describe: label => `cancel ${label}`,
  summary: (label, p) => `cancel ${label}: ${p.reason}`
};

const invoiceCancellation: RequestTypeHandler<InvoiceRow, ReasonPayload> = {
  targetType: 'invoice',
  title: 'Invoice cancellation requested',
  payloadSchema: z.object({ reason: reasonField }),
  load: loadInvoice,
  label: inv => inv.invoiceNumber,
  check: () => {},
  snapshot: () => ({}),
  apply: async (inv, p, ctx) => {
    await removeInvoice({
      invoiceId: inv._id,
      garageId: ctx.garageId,
      userId: ctx.approverId,
      note: `Cancelled at ${ctx.requesterName}'s request: ${p.reason}`
    });
  },
  describe: label => `cancel invoice ${label}`,
  summary: (label, p) => `cancel invoice ${label}: ${p.reason}`
};

// The one cast here: each handler is typed against its own target and payload,
// and the usecase only ever hands a handler the target it loaded itself.
const erase = <T, P>(handler: RequestTypeHandler<T, P>) =>
  handler as unknown as RequestTypeHandler<unknown, Record<string, unknown>>;

export const REQUEST_TYPES: Record<ChangeRequestType, RequestTypeHandler<unknown, Record<string, unknown>>> = {
  odometer_correction: erase(odometerCorrection),
  job_card_cancellation: erase(jobCardCancellation),
  invoice_cancellation: erase(invoiceCancellation)
};
