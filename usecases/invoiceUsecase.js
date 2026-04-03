const Invoice = require('../models/Invoice');
const JobCard = require('../models/JobCard');
const Inventory = require('../models/Inventory');
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

exports.removeInvoice = async ({ invoiceId, garageId }) => {
  const invoice = await Invoice.findOneAndDelete({ _id: invoiceId, garage: garageId });
  if (!invoice) {
    const error = new Error('Invoice not found');
    error.statusCode = 404;
    throw error;
  }
  return true;
};
