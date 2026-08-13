import { Types } from 'mongoose';
import Invoice from '../models/Invoice';
import JobCard from '../models/JobCard';
import Inventory from '../models/Inventory';
import Garage from '../models/Garage';
import * as reminderUsecase from './reminderUsecase';
import * as pdfService from '../services/pdfService';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { PaymentStatus, PaymentMethod } from '../types/domain';
import { FREE_PLAN_LIMITS } from '../config/planLimits';

const log = logger.child('InvoiceUsecase');

interface ListInput {
  garageId: Types.ObjectId | string;
  search?: string;
  paymentStatus?: string;
  page?: number | string;
  limit?: number | string;
}

export const getInvoicesList = async ({ garageId, search, paymentStatus, page = 1, limit = 20 }: ListInput) => {
  const query: Record<string, unknown> = { garage: garageId };

  if (search) {
    query.invoiceNumber = { $regex: search, $options: 'i' };
  }

  if (paymentStatus) {
    query.paymentStatus = paymentStatus;
  }

  const total = await Invoice.countDocuments(query);
  const invoices = await Invoice.find(query)
    .populate('customer', 'name phone')
    .populate('vehicle', 'licensePlate make model')
    .populate('jobCard', 'jobCardNumber')
    .sort('-createdAt')
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  return { invoices, total };
};

interface GetDetailsInput {
  invoiceId: string;
  garageId: Types.ObjectId | string;
}

export const getInvoiceDetails = async ({ invoiceId, garageId }: GetDetailsInput) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, garage: garageId })
    .populate('customer')
    .populate('vehicle')
    .populate('jobCard', 'jobCardNumber status odometerAtIntake')
    .populate('garage', 'name address phone email gstNumber')
    .populate('parts.inventoryItem', 'partName partNumber')
    .populate('createdBy', 'name')
    .lean();

  if (!invoice) {
    throw new HttpError('Invoice not found', 404);
  }
  return invoice;
};

interface GenerateInput {
  jobCardId: string;
  garageId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
}

export const generateInvoiceFromJobCard = async ({ jobCardId, garageId, userId }: GenerateInput) => {
  const jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    throw new HttpError('Job card not found', 404);
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const todayCount = await Invoice.countDocuments({
    garage: garageId,
    createdAt: { $gte: startOfToday, $lt: startOfTomorrow }
  });
  if (todayCount >= FREE_PLAN_LIMITS.maxInvoicesPerGaragePerDay) {
    throw new HttpError(
      `Daily invoice limit reached (${FREE_PLAN_LIMITS.maxInvoicesPerGaragePerDay}/day) on the free plan.`,
      403
    );
  }

  // Create invoice from job card
  const invoiceData = {
    jobCard: jobCard._id,
    customer: jobCard.customer,
    vehicle: jobCard.vehicle,
    garage: garageId,
    parts: jobCard.estimation.parts,
    labor: jobCard.estimation.labor,
    subtotal: jobCard.estimation.subtotal,
    taxRate: jobCard.estimation.taxRate,
    taxAmount: jobCard.estimation.taxAmount,
    discount: jobCard.estimation.discount,
    grandTotal: jobCard.estimation.grandTotal,
    createdBy: userId
  };

  const invoice = await Invoice.create(invoiceData);

  // side effect 1: link back to job card
  jobCard.invoice = invoice._id;
  jobCard.status = 'delivered';
  jobCard.statusHistory.push({
    status: 'delivered',
    changedBy: userId,
    notes: `Invoice ${invoice.invoiceNumber} generated`
  } as (typeof jobCard.statusHistory)[number]);
  await jobCard.save();

  // side effect 3: creating reminder for the delivered vehicle.
  try {
    await reminderUsecase.autoCreateFromDelivery({ jobCard: jobCard as unknown as Parameters<typeof reminderUsecase.autoCreateFromDelivery>[0]['jobCard'], garageId });
  } catch (reminderErr) {
    log.warn('Failed to auto-create service reminder', { error: (reminderErr as Error).message, jobCardId });
  }

  // side effect 2: deduct inventory stock
  const stockAdjustments = jobCard.estimation.parts.map(p =>
    Inventory.findByIdAndUpdate(p.inventoryItem, { $inc: { quantity: -p.quantity } })
  );
  await Promise.all(stockAdjustments);

  log.info('New invoice generated', {
    invoiceId: invoice._id,
    invoiceNumber: invoice.invoiceNumber,
    jobCardId: jobCard._id
  });

  return invoice;
};

interface UpdatePaymentInput {
  invoiceId: string;
  garageId: Types.ObjectId | string;
  paymentData: {
    paymentStatus?: PaymentStatus;
    paymentMethod?: PaymentMethod;
    amountPaid?: number;
  };
}

export const updatePaymentStatus = async ({ invoiceId, garageId, paymentData }: UpdatePaymentInput) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, garage: garageId });

  if (!invoice) {
    throw new HttpError('Invoice not found', 404);
  }

  if (paymentData.paymentMethod) {
    invoice.paymentMethod = paymentData.paymentMethod;
  }

  if (paymentData.amountPaid !== undefined) {
    invoice.amountPaid = paymentData.amountPaid;
  }

  // Auto-detect status from amount if not explicitly set
  if (paymentData.paymentStatus) {
    invoice.paymentStatus = paymentData.paymentStatus;
  } else if (invoice.amountPaid >= invoice.grandTotal) {
    invoice.paymentStatus = 'paid';
  } else if (invoice.amountPaid > 0) {
    invoice.paymentStatus = 'partial';
  } else {
    invoice.paymentStatus = 'unpaid';
  }

  if (invoice.paymentStatus === 'paid') {
    invoice.paidAt = new Date();
  }

  await invoice.save();
  log.info('Payment status updated', {
    invoiceId,
    newStatus: invoice.paymentStatus,
    amount: invoice.amountPaid
  });
  return invoice;
};

interface RemoveInput {
  invoiceId: string;
  garageId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
}

export const removeInvoice = async ({ invoiceId, garageId, userId }: RemoveInput): Promise<true> => {
  const invoice = await Invoice.findOne({ _id: invoiceId, garage: garageId });

  if (!invoice) {
    throw new HttpError('Invoice not found', 404);
  }

  // 1. Restore inventory stock
  log.info('Restoring inventory stock for cancelled invoice', { invoiceId });
  const stockRestoration = invoice.parts
    .filter(p => p.inventoryItem)
    .map(p => Inventory.findByIdAndUpdate(p.inventoryItem, { $inc: { quantity: p.quantity } }));
  await Promise.all(stockRestoration);

  // 2. Clear reference from JobCard and Reopen it
  const jobCard = await JobCard.findById(invoice.jobCard);
  if (jobCard) {
    jobCard.invoice = null;
    jobCard.status = 'approved'; // Revert to approved state so it can be edited/moved
    jobCard.statusHistory.push({
      status: 'approved',
      changedBy: userId,
      notes: `Invoice ${invoice.invoiceNumber} cancelled. Job reopened for editing.`
    } as (typeof jobCard.statusHistory)[number]);
    await jobCard.save();
    log.info('Job card reopened after invoice cancellation', { jobCardId: jobCard._id });
  }

  await Invoice.findByIdAndDelete(invoiceId);
  log.info('Invoice deleted and job card reopened', { invoiceId, garageId });
  return true;
};

interface PdfInput {
  invoiceId: string;
  garageId: Types.ObjectId | string;
}

export const generateInvoicePDFBuffer = async ({ invoiceId, garageId }: PdfInput) => {
  log.info('Generating invoice PDF', { invoiceId, garageId });

  const invoice = await getInvoiceDetails({ invoiceId, garageId });
  const garage = await Garage.findById(garageId).lean();

  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }

  // `jobCard` is populated with just a few fields for the PDF — odometerAtIntake
  // reflects the reading at the time of *this* service, unlike the vehicle's
  // own currentOdometerReading which may have moved on since.
  const odometerAtIntake = (invoice.jobCard as unknown as { odometerAtIntake?: number } | undefined)?.odometerAtIntake;
  const pdfData = { ...invoice, odometerAtIntake };
  const buffer = await pdfService.generateInvoicePDF(pdfData as unknown as Parameters<typeof pdfService.generateInvoicePDF>[0], garage);
  log.info('Invoice PDF generated successfully', { invoiceId, invoiceNumber: invoice.invoiceNumber, bytes: buffer.length });

  return { buffer, invoiceNumber: invoice.invoiceNumber };
};
