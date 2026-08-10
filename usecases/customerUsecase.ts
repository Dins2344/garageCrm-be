import { QueryFilter, Types } from 'mongoose';
import Customer, { ICustomer } from '../models/Customer';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('CustomerUsecase');

/**
 * CUSTOMER BUSINESS LOGIC (USE CASES)
 * Completely agnostic of HTTP/Express logic.
 */

interface ListInput {
  garageId: Types.ObjectId | string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

export const getCustomersList = async ({ garageId, search, page = 1, limit = 20 }: ListInput) => {
  log.info('Querying customers list', { garageId, search, page, limit });
  const query: QueryFilter<ICustomer> = { garage: garageId };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { phone: { $regex: search, $options: 'i' } }
    ];
  }

  const total = await Customer.countDocuments(query);
  const customers = await Customer.find(query)
    .populate('vehicles', 'licensePlate make model')
    .select('name phone email vehicles totalVisits totalSpent createdAt')
    .sort('-createdAt')
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  log.info('Customers list fetched', { garageId, count: customers.length, total });
  return { customers, total, page: Number(page), limit: Number(limit) };
};

interface GetByIdInput {
  customerId: string;
  garageId: Types.ObjectId | string;
}

export const getCustomerById = async ({ customerId, garageId }: GetByIdInput) => {
  log.info('Fetching customer by id', { customerId, garageId });
  const customer = await Customer.findOne({ _id: customerId, garage: garageId })
    .populate('vehicles')
    .lean();

  if (!customer) {
    log.warn('Customer not found', { customerId, garageId });
    throw new HttpError('Customer not found', 404);
  }

  log.info('Customer fetched', { customerId });
  return customer;
};

interface SaveInput {
  customerData: Partial<ICustomer>;
  garageId: Types.ObjectId | string;
}

export const saveCustomer = async ({ customerData, garageId }: SaveInput) => {
  log.info('Registering new customer', { garageId, phone: customerData.phone });
  const dataWithGarage = { ...customerData, garage: garageId };
  const customer = await Customer.create(dataWithGarage);
  log.info('New customer registered', { customerId: customer._id, garageId });
  return customer;
};

interface UpdateInput {
  customerId: string;
  garageId: Types.ObjectId | string;
  updateData: Partial<ICustomer>;
}

export const updateCustomerData = async ({ customerId, garageId, updateData }: UpdateInput) => {
  log.info('Updating customer data', { customerId, garageId, fields: Object.keys(updateData) });
  const customer = await Customer.findOneAndUpdate(
    { _id: customerId, garage: garageId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!customer) {
    log.warn('Customer not found for update', { customerId, garageId });
    throw new HttpError('Customer not found', 404);
  }

  log.info('Customer updated', { customerId });
  return customer;
};

interface RemoveInput {
  customerId: string;
  garageId: Types.ObjectId | string;
}

export const removeCustomer = async ({ customerId, garageId }: RemoveInput): Promise<true> => {
  log.info('Removing customer', { customerId, garageId });
  const customer = await Customer.findOneAndDelete({ _id: customerId, garage: garageId });

  if (!customer) {
    log.warn('Customer not found for deletion', { customerId, garageId });
    throw new HttpError('Customer not found', 404);
  }

  log.info('Customer deleted from registry', { customerId, garageId });
  return true;
};
