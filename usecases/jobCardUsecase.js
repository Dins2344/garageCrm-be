const JobCard = require('../models/JobCard');
const Vehicle = require('../models/Vehicle');
const reminderUsecase = require('./reminderUsecase');
const logger = require('../utils/logger');
const log = logger.child('JobCardUsecase');

exports.getActivityList = async ({ garageId, role, userId, status, mechanicId, search, page = 1, limit = 20 }) => {
  let query = { garage: garageId };

  if (role === 'mechanic') {
    query.assignedMechanic = userId;
  } else if (mechanicId) {
    query.assignedMechanic = mechanicId;
  }

  if (status) query.status = status;
  if (search) query.jobCardNumber = { $regex: search, $options: 'i' };

  const total = await JobCard.countDocuments(query);
  const jobCards = await JobCard.find(query)
    .populate('vehicle', 'licensePlate make model color')
    .populate('customer', 'name phone')
    .populate('assignedMechanic', 'name')
    .select('-estimation.parts -estimation.labor -statusHistory')
    .sort('-createdAt')
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  return { jobCards, total, page: parseInt(page), limit: parseInt(limit) };
};

exports.getJobCardDetails = async ({ jobCardId, garageId }) => {
  const jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId })
    .populate('vehicle')
    .populate('customer')
    .populate('assignedMechanic', 'name phone')
    .populate('createdBy', 'name')
    .populate('estimation.parts.inventoryItem', 'partName partNumber')
    .populate('invoice')
    .lean();

  if (!jobCard) {
    const err = new Error('Job card not found');
    err.statusCode = 404;
    throw err;
  }

  return jobCard;
};

exports.openJobCard = async ({ jobCardData, garageId, userId }) => {
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

exports.updateJobCardProgress = async ({ jobCardId, garageId, userId, updateData }) => {
  let jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    const err = new Error('Job card not found');
    err.statusCode = 404;
    throw err;
  }

  // Handle status transition logic
  if (updateData.status && updateData.status !== jobCard.status) {
    if (jobCard.status === 'cancelled') {
      const err = new Error('Cancelled job card cannot be reopened.');
      err.statusCode = 400;
      throw err;
    }

    if (!updateData.statusHistory) {
      updateData.statusHistory = [...jobCard.statusHistory];
    }
    updateData.statusHistory.push({
      status: updateData.status,
      changedBy: userId,
      notes: updateData.statusNotes || ''
    });

    if (updateData.status === 'delivered') {
      updateData.actualDeliveryDate = new Date();
    }
  }

  jobCard = await JobCard.findByIdAndUpdate(jobCardId, updateData, {
    new: true,
    runValidators: true
  }).populate('vehicle customer assignedMechanic createdBy');

  // Side effect: auto-create service reminder on delivery
  if (updateData.status === 'delivered') {
    try {
      await reminderUsecase.autoCreateFromDelivery({ jobCard, garageId });
    } catch (reminderErr) {
      log.warn('Failed to auto-create service reminder', { error: reminderErr.message, jobCardId });
    }
  }

  return jobCard;
};

exports.calculateAndSaveEstimation = async ({ jobCardId, garageId, estimationData }) => {
  let jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    const err = new Error('Job card not found');
    err.statusCode = 404;
    throw err;
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
    const error = new Error('Cannot edit estimation after invoice generation. Please reopen the job card first.');
    error.statusCode = 400;
    throw error;
  }

  jobCard.estimation = {
    parts: calculatedParts,
    labor: calculatedLabor,
    subtotal,
    taxRate: actualTaxRate,
    taxAmount: Math.round(taxAmount * 100) / 100,
    discount,
    grandTotal: Math.round(grandTotal * 100) / 100,
    approvedByCustomer: jobCard.estimation.approvedByCustomer
  };

  await jobCard.save();
  return jobCard;
};

exports.approveJobEstimation = async ({ jobCardId, garageId, userId }) => {
  let jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    const err = new Error('Job card not found');
    err.statusCode = 404;
    throw err;
  }

  jobCard.estimation.approvedByCustomer = true;
  jobCard.estimation.approvedAt = new Date();
  jobCard.status = 'approved';
  jobCard.statusHistory.push({
    status: 'approved',
    changedBy: userId,
    notes: 'Estimation approved by customer'
  });

  await jobCard.save();
  return jobCard;
};

exports.removeJobCard = async ({ jobCardId, garageId }) => {
  const jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    const err = new Error('Job card not found');
    err.statusCode = 404;
    throw err;
  }

  await Vehicle.findByIdAndUpdate(jobCard.vehicle, { $pull: { serviceHistory: jobCard._id } });
  await JobCard.findByIdAndDelete(jobCardId);
  return true;
};
