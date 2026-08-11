import { Request, Response, NextFunction } from 'express';
import * as customerUsecase from '../usecases/customerUsecase';
import logger from '../utils/logger';
const log = logger.child('CustomerController');

// @desc    Get all customers â€” Thin Controller
// @route   GET /api/customers
export const getCustomers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, page, limit } = req.query as { search?: string; page?: string; limit?: string };
    const garageId = req.garageId!;
    log.info('Fetching customers list', { garageId, search, page, limit });

    const { customers, total, page: currentPage, limit: currentLimit } = await customerUsecase.getCustomersList({
      garageId,
      search,
      page,
      limit
    });

    log.info('Customers list fetched', { garageId, count: customers.length, total });
    res.status(200).json({
      success: true,
      count: customers.length,
      total,
      pages: Math.ceil(total / currentLimit),
      currentPage,
      data: customers
    });
  } catch (error) {
    log.error('Failed to fetch customers', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get single customer
// @route   GET /api/customers/:id
export const getCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.garageId!;
    log.info('Fetching single customer', { customerId: id, garageId });
    const customer = await customerUsecase.getCustomerById({ customerId: id, garageId });
    log.info('Customer fetched', { customerId: id });
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    log.error('Failed to fetch customer', { customerId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Create customer
// @route   POST /api/customers
export const createCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.garageId!;
    log.info('Creating new customer', { garageId, phone: req.body.phone });
    const customer = await customerUsecase.saveCustomer({ customerData: req.body, garageId });
    log.info('Customer created', { customerId: customer._id, garageId });
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    log.error('Failed to create customer', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update customer
// @route   PUT /api/customers/:id
export const updateCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.garageId!;
    log.info('Updating customer', { customerId: id, garageId, fields: Object.keys(req.body) });
    const customer = await customerUsecase.updateCustomerData({ customerId: id, garageId, updateData: req.body });
    log.info('Customer updated', { customerId: id });
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    log.error('Failed to update customer', { customerId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Delete customer
// @route   DELETE /api/customers/:id
export const deleteCustomer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.garageId!;
    log.info('Deleting customer', { customerId: id, garageId });
    await customerUsecase.removeCustomer({ customerId: id, garageId });
    log.info('Customer deleted', { customerId: id, garageId });
    res.status(200).json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    log.error('Failed to delete customer', { customerId: req.params.id, error: (error as Error).message });
    next(error);
  }
};
