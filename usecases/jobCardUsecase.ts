import { randomUUID } from 'crypto';
import { and, count, desc, eq, gte, inArray, lt, notInArray, or } from 'drizzle-orm';
import { db, DbOrTx } from '../config/db';
import {
  jobCards, JobCardRow, IEstimationPart, IEstimationLabor, IEstimation,
  createJobCardSchema, updateJobCardSchema, estimationInputSchema,
  historyEntry, jobCardToApi, jobCardSummaryToApi, JobCardLookups
} from '../models/JobCard';
import { users, USER_PUBLIC_COLUMNS } from '../models/User';
import { inventory } from '../models/Inventory';
import { garages } from '../models/Garage';
import { vehicles } from '../models/Vehicle';
import { customers } from '../models/Customer';
import { invoices } from '../models/Invoice';
import * as reminderUsecase from './reminderUsecase';
import { sendEstimationEmail } from '../services/emailService';
import * as pdfService from '../services/pdfService';
import { runSchema } from '../utils/validation';
import { listParam, pagination, textMatches } from '../utils/query';
import { vehicleSearchCondition } from './vehicleUsecase';
import { nextJobCardNumber } from '../utils/numbering';
import { todayRange } from '../utils/dates';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { resolveGarageLocale } from '../utils/locale';
import { JOB_STATUSES, JobStatus, Role, TERMINAL_JOB_STATUSES } from '../types/domain';
import { FREE_PLAN_LIMITS } from '../config/plans';

const log = logger.child('JobCardUsecase');

// The projections `.populate()` used on each endpoint, verbatim.
const LIST_WITH = {
  vehicle: { columns: { _id: true, licensePlate: true, make: true, model: true, color: true } },
  customer: { columns: { _id: true, name: true, phone: true } },
  assignedMechanic: { columns: { _id: true, name: true } },
  assignedAdvisor: { columns: { _id: true, name: true } }
} as const;

const DETAIL_WITH = {
  vehicle: true,
  customer: true,
  assignedMechanic: { columns: { _id: true, name: true, phone: true } },
  assignedAdvisor: { columns: { _id: true, name: true, phone: true } },
  createdBy: { columns: { _id: true, name: true } },
  invoice: true
} as const;

/**
 * Resolves the user and inventory references embedded in the JSONB columns
 * (`statusHistory[].changedBy`, `estimation.parts[].inventoryItem`) — the two
 * populates that could not become joins.
 */
const lookupsFor = async (row: Pick<JobCardRow, 'statusHistory' | 'estimation'>, runner: DbOrTx = db): Promise<JobCardLookups> => {
  const userIds = [...new Set(row.statusHistory.map(h => h.changedBy).filter((id): id is string => !!id))];
  const itemIds = [...new Set(row.estimation.parts.map(p => p.inventoryItem).filter((id): id is string => !!id))];

  const [userRows, itemRows] = await Promise.all([
    userIds.length
      ? runner.select({ _id: users._id, name: users.name }).from(users).where(inArray(users._id, userIds))
      : [],
    itemIds.length
      ? runner.select({ _id: inventory._id, partName: inventory.partName, partNumber: inventory.partNumber })
          .from(inventory).where(inArray(inventory._id, itemIds))
      : []
  ]);

  return {
    usersById: new Map(userRows.map(u => [u._id, u as ApiObject])),
    inventoryById: new Map(itemRows.map(i => [i._id, i as ApiObject]))
  };
};

interface ListInput {
  garageId: string;
  role: Role;
  userId: string;
  /** One status, a comma-separated list, or an array — see `listParam`. */
  status?: string | string[];
  mechanicId?: string;
  vehicleId?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

const isJobStatus = (value: string): value is JobStatus => (JOB_STATUSES as readonly string[]).includes(value);

/** The statuses a list request asked for, or [] for all. An unknown value is a 400, not an empty list. */
const statusFilter = (raw: string | string[] | undefined): JobStatus[] => {
  const values = listParam(raw);
  const unknown = values.filter(v => !isJobStatus(v));
  if (unknown.length) throw new HttpError(`Status must be one of: ${JOB_STATUSES.join(', ')}`, 400);
  return values.filter(isJobStatus);
};

export const getActivityList = async ({ garageId, role, userId, status, mechanicId, vehicleId, search, page = 1, limit = 20 }: ListInput) => {
  const paging = pagination(page, limit);

  const mechanicFilter = role === 'mechanic' ? userId : mechanicId;
  const statuses = statusFilter(status);
  const term = search?.trim();
  const where = and(
    eq(jobCards.garageId, garageId),
    mechanicFilter ? eq(jobCards.assignedMechanicId, mechanicFilter) : undefined,
    vehicleId ? eq(jobCards.vehicleId, vehicleId) : undefined,
    statuses.length ? inArray(jobCards.status, statuses) : undefined,
    // Job card number, or anything the vehicle list would find (plate, make,
    // model, owner name) — a counter search is "the white Swift" as often as
    // it is a number.
    term ? or(
      textMatches(jobCards.jobCardNumber, term),
      inArray(
        jobCards.vehicleId,
        db.select({ id: vehicles._id }).from(vehicles)
          .where(and(eq(vehicles.garageId, garageId), vehicleSearchCondition(garageId, term)))
      ),
      inArray(
        jobCards.customerId,
        db.select({ id: customers._id }).from(customers)
          .where(and(eq(customers.garageId, garageId), textMatches(customers.name, term)))
      )
    ) : undefined
  );

  const [{ total }] = await db.select({ total: count() }).from(jobCards).where(where);
  const rows = await db.query.jobCards.findMany({
    columns: { statusHistory: false },
    with: LIST_WITH,
    where,
    orderBy: [desc(jobCards.createdAt), desc(jobCards._id)],
    offset: paging.offset,
    limit: paging.limit
  });

  return { jobCards: rows.map(jobCardSummaryToApi), total, page: paging.page, limit: paging.limit };
};

interface GetDetailsInput {
  jobCardId: string;
  garageId: string;
}

export const getJobCardDetails = async ({ jobCardId, garageId }: GetDetailsInput): Promise<ApiObject> => {
  const jobCard = await db.query.jobCards.findFirst({
    where: and(eq(jobCards._id, jobCardId), eq(jobCards.garageId, garageId)),
    with: DETAIL_WITH
  });

  if (!jobCard) {
    throw new HttpError('Job card not found', 404);
  }

  return jobCardToApi(jobCard, await lookupsFor(jobCard));
};

/** Loads a job card row in its garage or throws the endpoint's 404. */
const requireJobCard = async (jobCardId: string, garageId: string, runner: DbOrTx = db): Promise<JobCardRow> => {
  const jobCard = await runner.query.jobCards.findFirst({
    where: and(eq(jobCards._id, jobCardId), eq(jobCards.garageId, garageId))
  });
  if (!jobCard) {
    throw new HttpError('Job card not found', 404);
  }
  return jobCard;
};

interface OpenInput {
  jobCardData: Record<string, unknown>;
  garageId: string;
  userId: string;
}

export const openJobCard = async ({ jobCardData, garageId, userId }: OpenInput): Promise<ApiObject> => {
  const input = runSchema(createJobCardSchema, jobCardData);
  const { start, end } = todayRange();

  const [{ todayCount }] = await db.select({ todayCount: count() }).from(jobCards).where(and(
    eq(jobCards.garageId, garageId),
    gte(jobCards.createdAt, start),
    lt(jobCards.createdAt, end)
  ));
  if (todayCount >= FREE_PLAN_LIMITS.maxJobCardsPerGaragePerDay) {
    throw new HttpError(
      `Daily job card limit reached (${FREE_PLAN_LIMITS.maxJobCardsPerGaragePerDay}/day) on the free plan.`,
      403
    );
  }

  // The vehicle and customer must belong to this garage — the foreign keys
  // only know the rows exist, not whose they are.
  const [vehicle, customer] = await Promise.all([
    db.query.vehicles.findFirst({ columns: { _id: true }, where: and(eq(vehicles._id, input.vehicle), eq(vehicles.garageId, garageId)) }),
    db.query.customers.findFirst({ columns: { _id: true }, where: and(eq(customers._id, input.customer), eq(customers.garageId, garageId)) })
  ]);
  if (!vehicle) throw new HttpError('Vehicle not found', 404);
  if (!customer) throw new HttpError('Customer not found', 404);

  // A vehicle can only have one job card open at a time within a garage —
  // otherwise the same car ends up on two parallel workflows (two
  // estimations, two invoices). The existing one must reach a terminal state
  // (delivered or cancelled) before a new one can be opened.
  const activeJobCard = await db.query.jobCards.findFirst({
    columns: { jobCardNumber: true, status: true },
    where: and(
      eq(jobCards.garageId, garageId),
      eq(jobCards.vehicleId, input.vehicle),
      notInArray(jobCards.status, [...TERMINAL_JOB_STATUSES])
    )
  });
  if (activeJobCard) {
    throw new HttpError(
      `This vehicle already has an open job card (${activeJobCard.jobCardNumber}). ` +
      'Deliver or cancel it before creating a new one.',
      409
    );
  }

  const { vehicle: vehicleId, customer: customerId, assignedMechanic, assignedAdvisor, ...rest } = input;

  const jobCard = await db.transaction(async tx => {
    const jobCardNumber = await nextJobCardNumber(tx, garageId);
    const [created] = await tx.insert(jobCards).values({
      ...rest,
      jobCardNumber,
      vehicleId,
      customerId,
      assignedMechanicId: assignedMechanic,
      assignedAdvisorId: assignedAdvisor,
      garageId,
      createdById: userId,
      statusHistory: [historyEntry('new', userId, 'Job card created')]
    }).returning();
    return created;
  });

  log.info('New Job Card created', { jobCardId: jobCard._id, jobCardNumber: jobCard.jobCardNumber });
  return jobCardToApi(jobCard);
};

interface UpdateProgressInput {
  jobCardId: string;
  garageId: string;
  userId: string;
  updateData: Record<string, unknown>;
}

export const updateJobCardProgress = async ({ jobCardId, garageId, userId, updateData }: UpdateProgressInput): Promise<ApiObject> => {
  const jobCard = await requireJobCard(jobCardId, garageId);
  const { status, statusNotes, assignedMechanic, assignedAdvisor, ...changes } = runSchema(updateJobCardSchema, updateData);

  const set: Partial<JobCardRow> = { ...changes };
  if (assignedMechanic !== undefined) set.assignedMechanicId = assignedMechanic;
  if (assignedAdvisor !== undefined) set.assignedAdvisorId = assignedAdvisor;

  // Handle status transition logic
  if (status && status !== jobCard.status) {
    if (jobCard.status === 'cancelled') {
      throw new HttpError('Cancelled job card cannot be reopened.', 400);
    }

    set.status = status;
    set.statusHistory = [...jobCard.statusHistory, historyEntry(status, userId, statusNotes || '')];

    if (status === 'delivered') {
      set.actualDeliveryDate = new Date();
    }
  }

  // Generate a one-time estimation approval token when sending to customer
  let estimationToken: string | undefined;
  if (status === 'estimation_sent') {
    const hasParts = jobCard.estimation?.parts?.length > 0;
    const hasLabor = jobCard.estimation?.labor?.length > 0;

    if (!hasParts && !hasLabor) {
      throw new HttpError('Cannot send estimation without any parts or labor items.', 400);
    }

    estimationToken = randomUUID();
    set.estimationToken = estimationToken;
    set.estimation = { ...jobCard.estimation, sentAt: new Date().toISOString() };
  }

  if (Object.keys(set).length > 0) {
    await db.update(jobCards).set(set).where(and(eq(jobCards._id, jobCardId), eq(jobCards.garageId, garageId)));
  }

  const updated = await db.query.jobCards.findFirst({
    where: and(eq(jobCards._id, jobCardId), eq(jobCards.garageId, garageId)),
    with: {
      vehicle: true,
      customer: true,
      assignedMechanic: { columns: USER_PUBLIC_COLUMNS },
      createdBy: { columns: USER_PUBLIC_COLUMNS }
    }
  });
  if (!updated) {
    throw new HttpError('Job card not found', 404);
  }

  // Fire-and-forget: send estimation approval email
  if (status === 'estimation_sent') {
    (async () => {
      try {
        const garage = await db.query.garages.findFirst({ where: eq(garages._id, garageId) });
        const frontendUrl = process.env.CLIENT_URL || 'http://localhost:5173';
        const approvalLink = `${frontendUrl}/estimate/${estimationToken}`;
        await sendEstimationEmail({
          customerName: updated.customer?.name || 'Customer',
          customerEmail: updated.customer?.email,
          vehiclePlate: updated.vehicle?.licensePlate || '',
          vehicleMake: updated.vehicle?.make || '',
          vehicleModel: updated.vehicle?.model || '',
          jobCardNumber: updated.jobCardNumber,
          complaints: updated.complaints || [],
          grandTotal: updated.estimation?.grandTotal || 0,
          garageName: garage?.name || 'GaragePulse',
          garagePhone: garage?.phone || '',
          approvalLink,
          locale: resolveGarageLocale(garage)
        });
        log.info('Estimation email sent', { jobCardId, to: updated.customer?.email });
      } catch (emailErr) {
        // Never let email failure block the response
        log.warn('Failed to send estimation email', { jobCardId, error: (emailErr as Error).message });
      }
    })();
  }

  // Side effect: auto-create service reminder on delivery
  if (status === 'delivered' && status !== jobCard.status) {
    try {
      await reminderUsecase.autoCreateFromDelivery({ jobCard: updated, garageId });
    } catch (reminderErr) {
      log.warn('Failed to auto-create service reminder', { error: (reminderErr as Error).message, jobCardId });
    }
  }

  return jobCardToApi(updated);
};

interface EstimationInput {
  jobCardId: string;
  garageId: string;
  estimationData: Record<string, unknown>;
}

/**
 * The estimation tax formula — the source of truth.
 *
 * Both clients re-implement this as a live preview
 * (`frontend/src/pages/JobCardDetail.tsx`, `mobile/src/screens/EstimationEditorScreen.tsx`)
 * and must round to 2dp identically; `tests/taxParity.test.ts` pins that.
 * Extracted as a pure function so anything server-side needing totals calls it
 * rather than becoming a fourth copy.
 *
 * Note the deliberate asymmetry: `subtotal` is returned unrounded while
 * `taxAmount` and `grandTotal` round to 2dp. That is the existing behaviour and
 * what the clients mirror — do not "tidy" it into rounding all three.
 */
export const computeEstimationTotals = ({
  parts = [],
  labor = [],
  discount = 0,
  taxRate
}: {
  parts?: IEstimationPart[];
  labor?: IEstimationLabor[];
  discount?: number;
  taxRate: number;
}) => {
  const calculatedParts = parts.map(p => ({ ...p, total: p.quantity * p.unitPrice }));
  const calculatedLabor = labor.map(l => ({ ...l, total: l.hours * l.ratePerHour }));

  const partsTotal = calculatedParts.reduce((sum, p) => sum + p.total, 0);
  const laborTotal = calculatedLabor.reduce((sum, l) => sum + l.total, 0);
  const subtotal = partsTotal + laborTotal;
  const taxAmount = ((subtotal - discount) * taxRate) / 100;
  const grandTotal = subtotal - discount + taxAmount;

  return {
    parts: calculatedParts,
    labor: calculatedLabor,
    subtotal,
    taxRate,
    taxAmount: Math.round(taxAmount * 100) / 100,
    discount,
    grandTotal: Math.round(grandTotal * 100) / 100
  };
};

export const calculateAndSaveEstimation = async ({ jobCardId, garageId, estimationData }: EstimationInput): Promise<ApiObject> => {
  const jobCard = await requireJobCard(jobCardId, garageId);
  const { parts, labor, discount = 0, taxRate } = runSchema(estimationInputSchema, estimationData);

  const totals = computeEstimationTotals({
    parts: parts?.map(p => ({ ...p, total: 0 })),
    labor: labor?.map(l => ({ ...l, total: 0 })),
    discount,
    taxRate: taxRate !== undefined ? taxRate : jobCard.estimation.taxRate
  });

  if (jobCard.invoiceId) {
    throw new HttpError('Cannot edit estimation after invoice generation. Please reopen the job card first.', 400);
  }

  const estimation: IEstimation = {
    ...totals,
    approvedByCustomer: jobCard.estimation.approvedByCustomer,
    approvedAt: jobCard.estimation.approvedAt,
    sentAt: jobCard.estimation.sentAt
  };

  const [updated] = await db.update(jobCards).set({ estimation })
    .where(and(eq(jobCards._id, jobCardId), eq(jobCards.garageId, garageId)))
    .returning();
  return jobCardToApi(updated);
};

interface ApproveInput {
  jobCardId: string;
  garageId: string;
  userId: string;
}

export const approveJobEstimation = async ({ jobCardId, garageId, userId }: ApproveInput): Promise<ApiObject> => {
  const jobCard = await requireJobCard(jobCardId, garageId);

  const [updated] = await db.update(jobCards).set({
    estimation: { ...jobCard.estimation, approvedByCustomer: true, approvedAt: new Date().toISOString() },
    status: jobCard.status === 'estimation_sent' ? 'approved' : jobCard.status,
    statusHistory: [...jobCard.statusHistory, historyEntry('approved', userId, 'Estimation approved by customer')]
  }).where(and(eq(jobCards._id, jobCardId), eq(jobCards.garageId, garageId))).returning();

  return jobCardToApi(updated);
};

interface RemoveInput {
  jobCardId: string;
  garageId: string;
}

export const removeJobCard = async ({ jobCardId, garageId }: RemoveInput): Promise<true> => {
  const jobCard = await requireJobCard(jobCardId, garageId);

  // The invoice references the job card and is a financial record; Mongo left
  // it dangling, the foreign key refuses. Cancelling the invoice reopens the
  // card and clears the way.
  const [{ invoiceCount }] = await db.select({ invoiceCount: count() }).from(invoices)
    .where(and(eq(invoices.jobCardId, jobCardId), eq(invoices.garageId, garageId)));
  if (invoiceCount > 0 || jobCard.invoiceId) {
    throw new HttpError('This job card has an invoice. Cancel the invoice before deleting the job card.', 409);
  }

  await db.delete(jobCards).where(and(eq(jobCards._id, jobCardId), eq(jobCards.garageId, garageId)));
  log.info('Job card and service history reference removed', { jobCardId, garageId });
  return true;
};

interface PdfInput {
  jobCardId: string;
  garageId: string;
}

export const generateEstimationPDFBuffer = async ({ jobCardId, garageId }: PdfInput) => {
  log.info('Generating estimation PDF', { jobCardId, garageId });

  const jobCard = await getJobCardDetails({ jobCardId, garageId });
  const garage = await db.query.garages.findFirst({ where: eq(garages._id, garageId) });

  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }

  const buffer = await pdfService.generateEstimationPDF(
    jobCard as unknown as Parameters<typeof pdfService.generateEstimationPDF>[0],
    garage as unknown as Parameters<typeof pdfService.generateEstimationPDF>[1]
  );
  log.info('Estimation PDF generated successfully', { jobCardId, jobCardNumber: jobCard.jobCardNumber, bytes: buffer.length });

  return { buffer, jobCardNumber: jobCard.jobCardNumber as string };
};

/** Used by the invoice usecase, which mutates a job card from its own transaction. */
export { requireJobCard };

/** Shape the reminder usecase needs from a delivered job card. */
export type DeliveredJobCard = Pick<JobCardRow, '_id' | 'vehicleId' | 'customerId' | 'serviceType' | 'jobCardNumber'>;
