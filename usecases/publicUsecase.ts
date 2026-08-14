import JobCard from '../models/JobCard';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { resolveGarageLocale } from '../utils/locale';

const log = logger.child('PublicUsecase');

/**
 * Fetch a job card by its estimation token.
 * Returns only the fields needed for the customer-facing approval page.
 * No auth required — token security is the only guard.
 */
export const getEstimationByToken = async (token: string) => {
  const jobCard = await JobCard.findOne({ estimationToken: token })
    // `country settings` are needed so the (unauthenticated) approval page can
    // format money in the garage's currency instead of assuming rupees.
    .populate('vehicle', 'licensePlate make model year color fuelType')
    .populate('customer', 'name phone email')
    .populate('garage', 'name phone email address country settings')
    .lean();

  if (!jobCard) {
    throw new HttpError('This estimation link is invalid or has expired.', 404);
  }

  // Resolved here rather than on the client — this page has no session and so
  // no other route to the garage's locale.
  return { ...jobCard, locale: resolveGarageLocale(jobCard.garage as Parameters<typeof resolveGarageLocale>[0]) };
};

/**
 * Approve an estimation by token (customer action — no login required).
 * Idempotent: calling it on an already-approved job card is a no-op.
 */
export const approveEstimationByToken = async (token: string) => {
  const jobCard = await JobCard.findOne({ estimationToken: token });

  if (!jobCard) {
    throw new HttpError('This estimation link is invalid or has expired.', 404);
  }

  // Already approved — return current state (idempotent)
  if (jobCard.estimation.approvedByCustomer) {
    return jobCard;
  }

  jobCard.estimation.approvedByCustomer = true;
  jobCard.estimation.approvedAt = new Date();
  jobCard.status = (jobCard.status as string) === 'estimation' ? 'approved' : jobCard.status;
  jobCard.statusHistory.push({
    status: 'approved',
    notes: 'Estimation approved by customer via approval link'
  } as (typeof jobCard.statusHistory)[number]);

  await jobCard.save();
  log.info('Estimation approved by customer via token', { jobCardId: jobCard._id });
  return jobCard;
};
