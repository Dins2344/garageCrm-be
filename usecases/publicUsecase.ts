import { eq } from 'drizzle-orm';
import { db } from '../config/db';
import { jobCards, historyEntry, jobCardToApi } from '../models/JobCard';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { resolveGarageLocale } from '../utils/locale';

const log = logger.child('PublicUsecase');

/**
 * Fetch a job card by its estimation token.
 * Returns only the fields needed for the customer-facing approval page.
 * No auth required — token security is the only guard.
 */
export const getEstimationByToken = async (token: string): Promise<ApiObject> => {
  const jobCard = await db.query.jobCards.findFirst({
    where: eq(jobCards.estimationToken, token),
    with: {
      vehicle: { columns: { _id: true, licensePlate: true, make: true, model: true, year: true, color: true, fuelType: true } },
      customer: { columns: { _id: true, name: true, phone: true, email: true } },
      // `country settings` are needed so the (unauthenticated) approval page can
      // format money in the garage's currency instead of assuming rupees.
      garage: { columns: { _id: true, name: true, phone: true, email: true, address: true, country: true, settings: true } }
    }
  });

  if (!jobCard) {
    throw new HttpError('This estimation link is invalid or has expired.', 404);
  }

  // Resolved here rather than on the client — this page has no session and so
  // no other route to the garage's locale.
  return { ...jobCardToApi(jobCard), locale: resolveGarageLocale(jobCard.garage) };
};

/**
 * Approve an estimation by token (customer action — no login required).
 * Idempotent: calling it on an already-approved job card is a no-op.
 */
export const approveEstimationByToken = async (token: string): Promise<ApiObject> => {
  const jobCard = await db.query.jobCards.findFirst({ where: eq(jobCards.estimationToken, token) });

  if (!jobCard) {
    throw new HttpError('This estimation link is invalid or has expired.', 404);
  }

  // Already approved — return current state (idempotent)
  if (jobCard.estimation.approvedByCustomer) {
    return jobCardToApi(jobCard);
  }

  const [updated] = await db.update(jobCards).set({
    estimation: { ...jobCard.estimation, approvedByCustomer: true, approvedAt: new Date().toISOString() },
    status: jobCard.status === 'estimation_sent' ? 'approved' : jobCard.status,
    statusHistory: [...jobCard.statusHistory, historyEntry('approved', null, 'Estimation approved by customer via approval link')]
  }).where(eq(jobCards._id, jobCard._id)).returning();

  log.info('Estimation approved by customer via token', { jobCardId: jobCard._id });
  return jobCardToApi(updated);
};
