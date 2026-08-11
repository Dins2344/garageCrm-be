import { Request, Response, NextFunction } from 'express';
import * as invoiceUsecase from '../usecases/invoiceUsecase';
import logger from '../utils/logger';
const log = logger.child('InvoiceController');

// @desc    Get all invoices
// @route   GET /api/invoices
export const getInvoices = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, paymentStatus, page, limit } = req.query as Record<string, string | undefined>;
    const garageId = req.garageId!;
    log.info('Fetching invoices list', { garageId, search, paymentStatus, page, limit });

    const { invoices, total } = await invoiceUsecase.getInvoicesList({
      garageId,
      search,
      paymentStatus,
      page,
      limit
    });

    log.info('Invoices list fetched', { garageId, count: invoices.length, total });
    res.status(200).json({
      success: true,
      count: invoices.length,
      total,
      data: invoices
    });
  } catch (error) {
    log.error('Failed to fetch invoices', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get single invoice
// @route   GET /api/invoices/:id
export const getInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.garageId!;
    log.info('Fetching single invoice', { invoiceId: id, garageId });

    const invoice = await invoiceUsecase.getInvoiceDetails({ invoiceId: id, garageId });
    log.info('Invoice fetched successfully', { invoiceId: id, invoiceNumber: invoice.invoiceNumber });
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    log.error('Failed to fetch invoice', { invoiceId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Create invoice (from JobCard)
// @route   POST /api/invoices
export const createInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.garageId!;
    const { jobCardId } = req.body;
    log.info('Creating invoice from job card', { garageId, jobCardId, userId: req.user!._id });

    const invoice = await invoiceUsecase.generateInvoiceFromJobCard({
      jobCardId,
      garageId,
      userId: req.user!._id
    });

    log.info('Invoice created successfully', { invoiceId: invoice._id, invoiceNumber: invoice.invoiceNumber, garageId });
    res.status(201).json({ success: true, data: invoice });
  } catch (error) {
    log.error('Failed to create invoice', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update payment status
// @route   PUT /api/invoices/:id/payment
export const updatePaymentStatus = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.garageId!;
    log.info('Updating invoice payment status', { invoiceId: id, garageId, paymentData: req.body });

    const invoice = await invoiceUsecase.updatePaymentStatus({
      invoiceId: id,
      garageId,
      paymentData: req.body
    });

    log.info('Invoice payment status updated', { invoiceId: id, newStatus: invoice.paymentStatus, amountPaid: invoice.amountPaid });
    res.status(200).json({ success: true, data: invoice });
  } catch (error) {
    log.error('Failed to update payment status', { invoiceId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Delete invoice
// @route   DELETE /api/invoices/:id
export const deleteInvoice = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.garageId!;
    log.info('Deleting invoice', { invoiceId: id, garageId, userId: req.user!._id });

    await invoiceUsecase.removeInvoice({
      invoiceId: id,
      garageId,
      userId: req.user!._id
    });

    log.info('Invoice deleted', { invoiceId: id, garageId });
    res.status(200).json({ success: true, message: 'Invoice deleted successfully' });
  } catch (error) {
    log.error('Failed to delete invoice', { invoiceId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Download invoice as PDF
// @route   GET /api/invoices/:id/pdf
export const downloadInvoicePDF = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.garageId!;
    log.info('Invoice PDF download requested', { invoiceId: id, garageId, userId: req.user!._id });

    const { buffer, invoiceNumber } = await invoiceUsecase.generateInvoicePDFBuffer({
      invoiceId: id,
      garageId
    });

    log.info('Streaming invoice PDF to client', { invoiceId: id, invoiceNumber, bytes: buffer.length });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${invoiceNumber || 'invoice'}.pdf"`,
      'Content-Length': buffer.length
    });
    res.send(buffer);
  } catch (error) {
    log.error('Failed to generate invoice PDF', { invoiceId: req.params.id, error: (error as Error).message });
    next(error);
  }
};
