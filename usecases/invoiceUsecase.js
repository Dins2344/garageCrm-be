const Invoice = require('../models/Invoice');
const JobCard = require('../models/JobCard');
const Inventory = require('../models/Inventory');
const Garage = require('../models/Garage');
const reminderUsecase = require('./reminderUsecase');
const pdfService = require('../services/pdfService');
const logger = require('../utils/logger');
const log = logger.child('InvoiceUsecase');

exports.getInvoicesList = async ({ garageId, search, paymentStatus, page = 1, limit = 20 }) => {
  let query = { garage: garageId };

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
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return { invoices, total };
};

exports.getInvoiceDetails = async ({ invoiceId, garageId }) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, garage: garageId })
    .populate('customer')
    .populate('vehicle')
    .populate('jobCard', 'jobCardNumber status')
    .populate('garage', 'name address phone email gstNumber')
    .populate('parts.inventoryItem', 'partName partNumber')
    .populate('createdBy', 'name')
    .lean();

  if (!invoice) {
    const error = new Error('Invoice not found');
    error.statusCode = 404;
    throw error;
  }
  return invoice;
};

exports.generateInvoiceFromJobCard = async ({ jobCardId, garageId, userId }) => {
  const jobCard = await JobCard.findOne({ _id: jobCardId, garage: garageId });

  if (!jobCard) {
    const error = new Error('Job card not found');
    error.statusCode = 404;
    throw error;
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
  });
  await jobCard.save();

  // side effect 3: creating reminder for the delivered vehicle.
  try {
    await reminderUsecase.autoCreateFromDelivery({ jobCard, garageId });
  } catch (reminderErr) {
    log.warn('Failed to auto-create service reminder', { error: reminderErr.message, jobCardId });
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

exports.updatePaymentStatus = async ({ invoiceId, garageId, paymentData }) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, garage: garageId });

  if (!invoice) {
    const error = new Error('Invoice not found');
    error.statusCode = 404;
    throw error;
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

exports.removeInvoice = async ({ invoiceId, garageId, userId }) => {
  const invoice = await Invoice.findOne({ _id: invoiceId, garage: garageId });

  if (!invoice) {
    const error = new Error('Invoice not found');
    error.statusCode = 404;
    throw error;
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
    });
    await jobCard.save();
    log.info('Job card reopened after invoice cancellation', { jobCardId: jobCard._id });
  }

  await Invoice.findByIdAndDelete(invoiceId);
  log.info('Invoice deleted and job card reopened', { invoiceId, garageId });
  return true;
};

exports.generateInvoicePDFBuffer = async ({ invoiceId, garageId }) => {
  log.info('Generating invoice PDF', { invoiceId, garageId });

  const invoice = await exports.getInvoiceDetails({ invoiceId, garageId });
  const garage = await Garage.findById(garageId).lean();

  if (!garage) {
    const err = new Error('Garage not found');
    err.statusCode = 404;
    throw err;
  }

  const buffer = await pdfService.generateInvoicePDF(invoice, garage);
  log.info('Invoice PDF generated successfully', { invoiceId, invoiceNumber: invoice.invoiceNumber, bytes: buffer.length });

  return { buffer, invoiceNumber: invoice.invoiceNumber };
};

