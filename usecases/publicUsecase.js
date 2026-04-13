const JobCard = require('../models/JobCard');
const logger = require('../utils/logger');
const log = logger.child('PublicUsecase');

/**
 * Fetch a job card by its estimation token.
 * Returns only the fields needed for the customer-facing approval page.
 * No auth required — token security is the only guard.
 */
exports.getEstimationByToken = async (token) => {
  const jobCard = await JobCard.findOne({ estimationToken: token })
    .populate('vehicle', 'licensePlate make model year color fuelType')
    .populate('customer', 'name phone email')
    .populate('garage', 'name phone email address')
    .lean();

  if (!jobCard) {
    const err = new Error('This estimation link is invalid or has expired.');
    err.statusCode = 404;
    throw err;
  }

  return jobCard;
};

/**
 * Approve an estimation by token (customer action — no login required).
 * Idempotent: calling it on an already-approved job card is a no-op.
 */
exports.approveEstimationByToken = async (token) => {
  const jobCard = await JobCard.findOne({ estimationToken: token });

  if (!jobCard) {
    const err = new Error('This estimation link is invalid or has expired.');
    err.statusCode = 404;
    throw err;
  }

  // Already approved — return current state (idempotent)
  if (jobCard.estimation.approvedByCustomer) {
    return jobCard;
  }

  jobCard.estimation.approvedByCustomer = true;
  jobCard.estimation.approvedAt = new Date();
  jobCard.status = jobCard.status === 'estimation' ? 'approved' : jobCard.status;
  jobCard.statusHistory.push({
    status: 'approved',
    notes: 'Estimation approved by customer via approval link'
  });

  await jobCard.save();
  log.info('Estimation approved by customer via token', { jobCardId: jobCard._id });
  return jobCard;
};
