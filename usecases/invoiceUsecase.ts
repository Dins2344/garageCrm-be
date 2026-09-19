import { and, count, desc, eq, gte, ilike, inArray, lt, sql } from 'drizzle-orm';
import { db, DbOrTx } from '../config/db';
import { invoices, InvoiceRow, paymentUpdateSchema, invoiceToApi } from '../models/Invoice';
import { jobCards, historyEntry } from '../models/JobCard';
import { inventory } from '../models/Inventory';
import { garages } from '../models/Garage';
import { requireJobCard } from './jobCardUsecase';
import * as reminderUsecase from './reminderUsecase';
import * as pdfService from '../services/pdfService';
import { runSchema } from '../utils/validation';
import { containsPattern, pagination } from '../utils/query';
import { nextInvoiceNumber } from '../utils/numbering';
import { todayRange } from '../utils/dates';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { FREE_PLAN_LIMITS } from '../config/plans';

const log = logger.child('InvoiceUsecase');

/** Resolves `parts[].inventoryItem` the way `.populate('parts.inventoryItem', 'partName partNumber')` did. */
const inventoryLookup = async (row: Pick<InvoiceRow, 'parts'>, runner: DbOrTx = db) => {
  const ids = [...new Set(row.parts.map(p => p.inventoryItem).filter((id): id is string => !!id))];
  const items = ids.length
    ? await runner.select({ _id: inventory._id, partName: inventory.partName, partNumber: inventory.partNumber })
        .from(inventory).where(inArray(inventory._id, ids))
    : [];
  return { inventoryById: new Map(items.map(i => [i._id, i as ApiObject])) };
};

interface ListInput {
  garageId: string;
  search?: string;
  paymentStatus?: string;
  page?: number | string;
  limit?: number | string;
}

export const getInvoicesList = async ({ garageId, search, paymentStatus, page = 1, limit = 20 }: ListInput) => {
  const paging = pagination(page, limit);
  const where = and(
    eq(invoices.garageId, garageId),
    search ? ilike(invoices.invoiceNumber, containsPattern(search)) : undefined,
    paymentStatus ? eq(invoices.paymentStatus, paymentStatus) : undefined
  );

  const [{ total }] = await db.select({ total: count() }).from(invoices).where(where);
  const rows = await db.query.invoices.findMany({
    with: {
      customer: { columns: { _id: true, name: true, phone: true } },
      vehicle: { columns: { _id: true, licensePlate: true, make: true, model: true } },
      jobCard: { columns: { _id: true, jobCardNumber: true } }
    },
    where,
    orderBy: [desc(invoices.createdAt)],
    offset: paging.offset,
    limit: paging.limit
  });

  return { invoices: rows.map(row => invoiceToApi(row)), total };
};

interface GetDetailsInput {
  invoiceId: string;
  garageId: string;
}

export const getInvoiceDetails = async ({ invoiceId, garageId }: GetDetailsInput): Promise<ApiObject> => {
  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices._id, invoiceId), eq(invoices.garageId, garageId)),
    with: {
      customer: true,
      vehicle: true,
      jobCard: { columns: { _id: true, jobCardNumber: true, status: true, odometerAtIntake: true } },
      garage: { columns: { _id: true, name: true, address: true, phone: true, email: true, gstNumber: true } },
      createdBy: { columns: { _id: true, name: true } }
    }
  });

  if (!invoice) {
    throw new HttpError('Invoice not found', 404);
  }
  return invoiceToApi(invoice, await inventoryLookup(invoice));
};

interface GenerateInput {
  jobCardId: string;
  garageId: string;
  userId: string;
}

export const generateInvoiceFromJobCard = async ({ jobCardId, garageId, userId }: GenerateInput): Promise<ApiObject> => {
  const jobCard = await requireJobCard(jobCardId, garageId);
  const { start, end } = todayRange();

  const [{ todayCount }] = await db.select({ todayCount: count() }).from(invoices).where(and(
    eq(invoices.garageId, garageId),
    gte(invoices.createdAt, start),
    lt(invoices.createdAt, end)
  ));
  if (todayCount >= FREE_PLAN_LIMITS.maxInvoicesPerGaragePerDay) {
    throw new HttpError(
      `Daily invoice limit reached (${FREE_PLAN_LIMITS.maxInvoicesPerGaragePerDay}/day) on the free plan.`,
      403
    );
  }

  // The invoice, the job card's link back to it, and the stock deduction all
  // land together or not at all.
  const invoice = await db.transaction(async tx => {
    const invoiceNumber = await nextInvoiceNumber(tx, garageId);
    const [created] = await tx.insert(invoices).values({
      invoiceNumber,
      jobCardId: jobCard._id,
      customerId: jobCard.customerId,
      vehicleId: jobCard.vehicleId,
      garageId,
      parts: jobCard.estimation.parts,
      labor: jobCard.estimation.labor,
      subtotal: jobCard.estimation.subtotal,
      taxRate: jobCard.estimation.taxRate,
      taxAmount: jobCard.estimation.taxAmount,
      discount: jobCard.estimation.discount,
      grandTotal: jobCard.estimation.grandTotal,
      createdById: userId
    }).returning();

    // side effect 1: link back to job card
    await tx.update(jobCards).set({
      invoiceId: created._id,
      status: 'delivered',
      statusHistory: [...jobCard.statusHistory, historyEntry('delivered', userId, `Invoice ${created.invoiceNumber} generated`)]
    }).where(and(eq(jobCards._id, jobCard._id), eq(jobCards.garageId, garageId)));

    // side effect 2: deduct inventory stock
    for (const part of jobCard.estimation.parts) {
      if (!part.inventoryItem) continue;
      await tx.update(inventory)
        .set({ quantity: sql`${inventory.quantity} - ${part.quantity}` })
        .where(and(eq(inventory._id, part.inventoryItem), eq(inventory.garageId, garageId)));
    }

    return created;
  });

  // side effect 3: creating reminder for the delivered vehicle.
  try {
    await reminderUsecase.autoCreateFromDelivery({ jobCard, garageId });
  } catch (reminderErr) {
    log.warn('Failed to auto-create service reminder', { error: (reminderErr as Error).message, jobCardId });
  }

  log.info('New invoice generated', {
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    jobCardId: jobCard._id
  });

  return invoiceToApi(invoice);
};

interface UpdatePaymentInput {
  invoiceId: string;
  garageId: string;
  paymentData: Record<string, unknown>;
}

export const updatePaymentStatus = async ({ invoiceId, garageId, paymentData }: UpdatePaymentInput): Promise<ApiObject> => {
  const scope = and(eq(invoices._id, invoiceId), eq(invoices.garageId, garageId));
  const invoice = await db.query.invoices.findFirst({ where: scope });

  if (!invoice) {
    throw new HttpError('Invoice not found', 404);
  }

  const payment = runSchema(paymentUpdateSchema, paymentData);
  const set: Partial<InvoiceRow> = {};

  if (payment.paymentMethod) {
    set.paymentMethod = payment.paymentMethod;
  }
  if (payment.notes !== undefined) {
    set.notes = payment.notes;
  }

  const amountPaid = payment.amountPaid !== undefined ? payment.amountPaid : invoice.amountPaid;
  if (payment.amountPaid !== undefined) {
    set.amountPaid = amountPaid;
  }

  // Auto-detect status from amount if not explicitly set
  if (payment.paymentStatus) {
    set.paymentStatus = payment.paymentStatus;
  } else if (amountPaid >= invoice.grandTotal) {
    set.paymentStatus = 'paid';
  } else if (amountPaid > 0) {
    set.paymentStatus = 'partial';
  } else {
    set.paymentStatus = 'unpaid';
  }

  if (set.paymentStatus === 'paid') {
    set.paidAt = new Date();
  }

  const [updated] = await db.update(invoices).set(set).where(scope).returning();
  log.info('Payment status updated', {
    invoiceId,
    newStatus: updated.paymentStatus,
    amount: updated.amountPaid
  });
  return invoiceToApi(updated);
};

interface RemoveInput {
  invoiceId: string;
  garageId: string;
  userId: string;
}

export const removeInvoice = async ({ invoiceId, garageId, userId }: RemoveInput): Promise<true> => {
  const invoice = await db.query.invoices.findFirst({
    where: and(eq(invoices._id, invoiceId), eq(invoices.garageId, garageId))
  });

  if (!invoice) {
    throw new HttpError('Invoice not found', 404);
  }

  await db.transaction(async tx => {
    // 1. Restore inventory stock
    log.info('Restoring inventory stock for cancelled invoice', { invoiceId });
    for (const part of invoice.parts) {
      if (!part.inventoryItem) continue;
      await tx.update(inventory)
        .set({ quantity: sql`${inventory.quantity} + ${part.quantity}` })
        .where(and(eq(inventory._id, part.inventoryItem), eq(inventory.garageId, garageId)));
    }

    // 2. Clear reference from JobCard and reopen it
    const jobCard = await tx.query.jobCards.findFirst({
      where: and(eq(jobCards._id, invoice.jobCardId), eq(jobCards.garageId, garageId))
    });
    if (jobCard) {
      await tx.update(jobCards).set({
        invoiceId: null,
        status: 'approved', // Revert to approved state so it can be edited/moved
        statusHistory: [
          ...jobCard.statusHistory,
          historyEntry('approved', userId, `Invoice ${invoice.invoiceNumber} cancelled. Job reopened for editing.`)
        ]
      }).where(eq(jobCards._id, jobCard._id));
      log.info('Job card reopened after invoice cancellation', { jobCardId: jobCard._id });
    }

    await tx.delete(invoices).where(eq(invoices._id, invoiceId));
  });

  log.info('Invoice deleted and job card reopened', { invoiceId, garageId });
  return true;
};

interface PdfInput {
  invoiceId: string;
  garageId: string;
}

export const generateInvoicePDFBuffer = async ({ invoiceId, garageId }: PdfInput) => {
  log.info('Generating invoice PDF', { invoiceId, garageId });

  const invoice = await getInvoiceDetails({ invoiceId, garageId });
  const garage = await db.query.garages.findFirst({ where: eq(garages._id, garageId) });

  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }

  // `jobCard` is joined with just a few fields for the PDF — odometerAtIntake
  // reflects the reading at the time of *this* service, unlike the vehicle's
  // own currentOdometerReading which may have moved on since.
  const odometerAtIntake = (invoice.jobCard as { odometerAtIntake?: number } | undefined)?.odometerAtIntake;
  const pdfData = { ...invoice, odometerAtIntake };
  const buffer = await pdfService.generateInvoicePDF(
    pdfData as unknown as Parameters<typeof pdfService.generateInvoicePDF>[0],
    garage as unknown as Parameters<typeof pdfService.generateInvoicePDF>[1]
  );
  log.info('Invoice PDF generated successfully', { invoiceId, invoiceNumber: invoice.invoiceNumber, bytes: buffer.length });

  return { buffer, invoiceNumber: invoice.invoiceNumber as string };
};
