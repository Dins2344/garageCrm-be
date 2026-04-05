const invoiceUsecase = require('../usecases/invoiceUsecase');
const pdfService = require('../services/pdfService');
const Garage = require('../models/Garage');
const logger = require('../utils/logger');
const log = logger.child('InvoiceController');

// @desc    Get all invoices
// @route   GET /api/invoices
exports.getInvoices = async (req, res, next) => {
  try {
    const { search, paymentStatus, page, limit } = req.query;
    const { invoices, total } = await invoiceUsecase.getInvoicesList({
      garageId: req.user.garage._id,
      search,
      paymentStatus,
      page,
      limit
    });

    res.status(200).json({
      success: true,
      count: invoices.length,
      total,
      data: invoices
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single invoice
// @route   GET /api/invoices/:id
exports.getInvoice = async (req, res, next) => {
  try {
    const invoice = await invoiceUsecase.getInvoiceDetails({
      invoiceId: req.params.id,
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

// @desc    Create invoice (from JobCard)
// @route   POST /api/invoices
exports.createInvoice = async (req, res, next) => {
  try {
    const invoice = await invoiceUsecase.generateInvoiceFromJobCard({
      jobCardId: req.body.jobCardId,
      garageId: req.user.garage._id,
      userId: req.user._id
    });
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

// @desc    Update payment status
// @route   PUT /api/invoices/:id/payment
exports.updatePaymentStatus = async (req, res, next) => {
  try {
    const invoice = await invoiceUsecase.updatePaymentStatus({
      invoiceId: req.params.id,
      garageId: req.user.garage._id,
      paymentData: req.body
    });
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete invoice
// @route   DELETE /api/invoices/:id
exports.deleteInvoice = async (req, res, next) => {
  try {
    await invoiceUsecase.removeInvoice({
      invoiceId: req.params.id,
      garageId: req.user.garage._id,
      userId: req.user._id
    });
    res.status(200).json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Download invoice as PDF
// @route   GET /api/invoices/:id/pdf
exports.downloadInvoicePDF = async (req, res, next) => {
  try {
    const invoice = await invoiceUsecase.getInvoiceDetails({
      invoiceId: req.params.id,
      garageId: req.user.garage._id
    });

    const garage = await Garage.findById(req.user.garage._id).lean();

    const pdfBuffer = await pdfService.generateInvoicePDF(invoice, garage);

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoice.invoiceNumber || 'invoice'}.pdf"`,
      'Content-Length': pdfBuffer.length
    });
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

