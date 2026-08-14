import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import JobCard, { IJobCard, IEstimationPart, IEstimationLabor } from '../models/JobCard';
import Vehicle from '../models/Vehicle';
import Garage from '../models/Garage';
import * as reminderUsecase from './reminderUsecase';
import { sendEstimationEmail } from '../services/emailService';
import * as pdfService from '../services/pdfService';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { JobStatus, Role, TERMINAL_JOB_STATUSES } from '../types/domain';
import { FREE_PLAN_LIMITS } from '../config/planLimits';

const log = logger.child('JobCardUsecase');

interface ListInput {
  garageId: Types.ObjectId | string;
  role: Role;
  userId: Types.ObjectId | string;
  status?: string;
  mechanicId?: string;
  vehicleId?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

export const getActivityList = async ({ garageId, role, userId, status, mechanicId, vehicleId, search, page = 1, limit = 20 }: ListInput) => {
  const query: Record<string, unknown> = { garage: garageId };

  if (role === 'mechanic') {
    query.assignedMechanic = userId;
  } else if (mechanicId) {
    query.assignedMechanic = mechanicId;
  }

  if (vehicleId) query.vehicle = vehicleId;
  if (status) query.status = status;
  if (search) query.jobCardNumber = { $regex: search, $options: 'i' };

  const total = await JobCard.countDocuments(query);
  const jobCards = await JobCard.find(query)
    .populate('vehicle', 'licensePlate make model color')
    .populate('customer', 'name phone')
    .populate('assignedMechanic', 'name')
    .populate('assignedAdvisor', 'name')
    .select('-estimation.parts -estimation.labor -statusHistory')
    .sort('-createdAt')
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  return { jobCards, total, page: Number(page), limit: Number(limit) };
};

interface GetDetailsInput {
  jobCardId: string;
  garageId: Types.ObjectId | string;
}

export const getJobCardDetails = async ({ jobCardId, garageId }: GetDetailsInput) => {
  const jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId })
    .populate('vehicle')
    .populate('customer')
    .populate('assignedMechanic', 'name phone')
    .populate('assignedAdvisor', 'name phone')
    .populate('createdBy', 'name')
    .populate('estimation.parts.inventoryItem', 'partName partNumber')
    .populate('invoice')
    .populate('statusHistory.changedBy', 'name')
    .lean();

  if (!jobCard) {
    throw new HttpError('Job card not found', 404);
  }

  return jobCard;
};

interface OpenInput {
  jobCardData: Partial<IJobCard>;
  garageId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
}

export const openJobCard = async ({ jobCardData, garageId, userId }: OpenInput) => {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

  const todayCount = await JobCard.countDocuments({
    garage: garageId,
    createdAt: { $gte: startOfToday, $lt: startOfTomorrow }
  });
  if (todayCount >= FREE_PLAN_LIMITS.maxJobCardsPerGaragePerDay) {
    throw new HttpError(
      `Daily job card limit reached (${FREE_PLAN_LIMITS.maxJobCardsPerGaragePerDay}/day) on the free plan.`,
      403
    );
  }

  // A vehicle can only have one job card open at a time within a garage —
  // otherwise the same car ends up on two parallel workflows (two
  // estimations, two invoices). The existing one must reach a terminal state
  // (delivered or cancelled) before a new one can be opened.
  if (jobCardData.vehicle) {
    const activeJobCard = await JobCard.findOne({
      garage: garageId,
      vehicle: jobCardData.vehicle,
      status: { $nin: TERMINAL_JOB_STATUSES }
    }).select('jobCardNumber status');

    if (activeJobCard) {
      throw new HttpError(
        `This vehicle already has an open job card (${activeJobCard.jobCardNumber}). ` +
        'Deliver or cancel it before creating a new one.',
        409
      );
    }
  }

  const data = {
    ...jobCardData,
    garage: garageId,
    createdBy: userId,
    statusHistory: [{
      status: 'new',
      changedBy: userId,
      notes: 'Job card created'
    }]
  };

  const jobCard = await JobCard.create(data);

  // side effect: update vehicle history
  await Vehicle.findByIdAndUpdate(jobCard.vehicle, {
    $push: { serviceHistory: jobCard._id }
  });

  log.info('New Job Card created', { jobCardId: jobCard._id, jobCardNumber: jobCard.jobCardNumber });
  return jobCard;
};

interface UpdateProgressInput {
  jobCardId: string;
  garageId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
  updateData: Record<string, unknown> & { status?: JobStatus; statusNotes?: string; statusHistory?: unknown[] };
}

export const updateJobCardProgress = async ({ jobCardId, garageId, userId, updateData }: UpdateProgressInput) => {
  let jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    throw new HttpError('Job card not found', 404);
  }

  // Handle status transition logic
  if (updateData.status && updateData.status !== jobCard.status) {
    if (jobCard.status === 'cancelled') {
      throw new HttpError('Cancelled job card cannot be reopened.', 400);
    }

    if (!updateData.statusHistory) {
      updateData.statusHistory = [...jobCard.statusHistory];
    }
    (updateData.statusHistory as unknown[]).push({
      status: updateData.status,
      changedBy: userId,
      notes: updateData.statusNotes || ''
    });

    if (updateData.status === 'delivered') {
      updateData.actualDeliveryDate = new Date();
    }
  }

  // Generate a one-time estimation approval token when sending to customer
  if (updateData.status === 'estimation_sent') {
    const hasParts = jobCard.estimation?.parts?.length > 0;
    const hasLabor = jobCard.estimation?.labor?.length > 0;

    if (!hasParts && !hasLabor) {
      throw new HttpError('Cannot send estimation without any parts or labor items.', 400);
    }

    updateData.estimationToken = randomUUID();
    updateData['estimation.sentAt'] = new Date();
  }

  jobCard = await JobCard.findByIdAndUpdate(jobCardId, updateData, {
    new: true,
    runValidators: true
  }).populate('vehicle customer assignedMechanic createdBy');

  // Fire-and-forget: send estimation approval email
  if (updateData.status === 'estimation_sent' && jobCard) {
    (async () => {
      try {
        const garage = await Garage.findById(garageId).lean();
        const frontendUrl = process.env.CLIENT_URL || 'http://localhost:5173';
        const approvalLink = `${frontendUrl}/estimate/${updateData.estimationToken}`;
        const customer = jobCard!.customer as unknown as { name?: string; email?: string };
        const vehicle = jobCard!.vehicle as unknown as { licensePlate?: string; make?: string; model?: string };
        await sendEstimationEmail({
          customerName: customer?.name || 'Customer',
          customerEmail: customer?.email,
          vehiclePlate: vehicle?.licensePlate || '',
          vehicleMake: vehicle?.make || '',
          vehicleModel: vehicle?.model || '',
          jobCardNumber: jobCard!.jobCardNumber,
          complaints: jobCard!.complaints || [],
          grandTotal: jobCard!.estimation?.grandTotal || 0,
          garageName: garage?.name || 'GaragePulse',
          garagePhone: garage?.phone || '',
          approvalLink
        });
        log.info('Estimation email sent', { jobCardId, to: customer?.email });
      } catch (emailErr) {
        // Never let email failure block the response
        log.warn('Failed to send estimation email', { jobCardId, error: (emailErr as Error).message });
      }
    })();
  }

  // Side effect: auto-create service reminder on delivery
  if (updateData.status === 'delivered' && jobCard) {
    try {
      await reminderUsecase.autoCreateFromDelivery({ jobCard: jobCard as unknown as Parameters<typeof reminderUsecase.autoCreateFromDelivery>[0]['jobCard'], garageId });
    } catch (reminderErr) {
      log.warn('Failed to auto-create service reminder', { error: (reminderErr as Error).message, jobCardId });
    }
  }

  return jobCard;
};

interface EstimationInput {
  jobCardId: string;
  garageId: Types.ObjectId | string;
  estimationData: {
    parts?: IEstimationPart[];
    labor?: IEstimationLabor[];
    discount?: number;
    taxRate?: number;
  };
}

export const calculateAndSaveEstimation = async ({ jobCardId, garageId, estimationData }: EstimationInput) => {
  const jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    throw new HttpError('Job card not found', 404);
  }

  const { parts = [], labor = [], discount = 0, taxRate } = estimationData;

  const calculatedParts = parts.map(p => ({ ...p, total: p.quantity * p.unitPrice }));
  const calculatedLabor = labor.map(l => ({ ...l, total: l.hours * l.ratePerHour }));

  const partsTotal = calculatedParts.reduce((sum, p) => sum + p.total, 0);
  const laborTotal = calculatedLabor.reduce((sum, l) => sum + l.total, 0);
  const subtotal = partsTotal + laborTotal;
  const actualTaxRate = taxRate !== undefined ? taxRate : jobCard.estimation.taxRate;
  const taxAmount = ((subtotal - discount) * actualTaxRate) / 100;
  const grandTotal = subtotal - discount + taxAmount;

  if (jobCard.invoice) {
    throw new HttpError('Cannot edit estimation after invoice generation. Please reopen the job card first.', 400);
  }

  jobCard.estimation = {
    parts: calculatedParts,
    labor: calculatedLabor,
    subtotal,
    taxRate: actualTaxRate,
    taxAmount: Math.round(taxAmount * 100) / 100,
    discount,
    grandTotal: Math.round(grandTotal * 100) / 100,
    approvedByCustomer: jobCard.estimation.approvedByCustomer,
    approvedAt: jobCard.estimation.approvedAt,
    sentAt: jobCard.estimation.sentAt
  };

  await jobCard.save();
  return jobCard;
};

interface ApproveInput {
  jobCardId: string;
  garageId: Types.ObjectId | string;
  userId: Types.ObjectId | string;
}

export const approveJobEstimation = async ({ jobCardId, garageId, userId }: ApproveInput) => {
  const jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    throw new HttpError('Job card not found', 404);
  }

  jobCard.estimation.approvedByCustomer = true;
  jobCard.estimation.approvedAt = new Date();
  jobCard.status = jobCard.status === 'estimation_sent' ? 'approved' : jobCard.status;
  jobCard.statusHistory.push({
    status: 'approved',
    changedBy: userId,
    notes: 'Estimation approved by customer'
  } as (typeof jobCard.statusHistory)[number]);

  await jobCard.save();
  return jobCard;
};

interface RemoveInput {
  jobCardId: string;
  garageId: Types.ObjectId | string;
}

export const removeJobCard = async ({ jobCardId, garageId }: RemoveInput): Promise<true> => {
  const jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    throw new HttpError('Job card not found', 404);
  }

  await Vehicle.findByIdAndUpdate(jobCard.vehicle, { $pull: { serviceHistory: jobCard._id } });
  await JobCard.findByIdAndDelete(jobCardId);
  log.info('Job card and service history reference removed', { jobCardId, garageId });
  return true;
};

interface PdfInput {
  jobCardId: string;
  garageId: Types.ObjectId | string;
}

export const generateEstimationPDFBuffer = async ({ jobCardId, garageId }: PdfInput) => {
  log.info('Generating estimation PDF', { jobCardId, garageId });

  const jobCard = await getJobCardDetails({ jobCardId, garageId });
  const garage = await Garage.findById(garageId).lean();

  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }

  const buffer = await pdfService.generateEstimationPDF(jobCard as unknown as Parameters<typeof pdfService.generateEstimationPDF>[0], garage);
  log.info('Estimation PDF generated successfully', { jobCardId, jobCardNumber: jobCard.jobCardNumber, bytes: buffer.length });

  return { buffer, jobCardNumber: jobCard.jobCardNumber };
};
