const Customer = require('../models/Customer');
const logger = require('../utils/logger');
const log = logger.child('CustomerUsecase');

/**
 * CUSTOMER BUSINESS LOGIC (USE CASES)
 * Completely agnostic of HTTP/Express logic.
 */

exports.getCustomersList = async ({ garageId, search, page = 1, limit = 20 }) => {
  log.info('Querying customers list', { garageId, search, page, limit });
  let query = { garage: garageId };

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
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  log.info('Customers list fetched', { garageId, count: customers.length, total });
  return { customers, total, page: parseInt(page), limit: parseInt(limit) };
};

exports.getCustomerById = async ({ customerId, garageId }) => {
  log.info('Fetching customer by id', { customerId, garageId });
  const customer = await Customer.findOne({ _id: customerId, garage: garageId })
    .populate('vehicles')
    .lean();

  if (!customer) {
    log.warn('Customer not found', { customerId, garageId });
    const err = new Error('Customer not found');
    err.statusCode = 404;
    throw err;
  }

  log.info('Customer fetched', { customerId });
  return customer;
};

exports.saveCustomer = async ({ customerData, garageId }) => {
  log.info('Registering new customer', { garageId, phone: customerData.phone });
  customerData.garage = garageId;
  const customer = await Customer.create(customerData);
  log.info('New customer registered', { customerId: customer._id, garageId });
  return customer;
};

exports.updateCustomerData = async ({ customerId, garageId, updateData }) => {
  log.info('Updating customer data', { customerId, garageId, fields: Object.keys(updateData) });
  const customer = await Customer.findOneAndUpdate(
    { _id: customerId, garage: garageId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!customer) {
    log.warn('Customer not found for update', { customerId, garageId });
    const err = new Error('Customer not found');
    err.statusCode = 404;
    throw err;
  }

  log.info('Customer updated', { customerId });
  return customer;
};

exports.removeCustomer = async ({ customerId, garageId }) => {
  log.info('Removing customer', { customerId, garageId });
  const customer = await Customer.findOneAndDelete({ _id: customerId, garage: garageId });

  if (!customer) {
    log.warn('Customer not found for deletion', { customerId, garageId });
    const err = new Error('Customer not found');
    err.statusCode = 404;
    throw err;
  }

  log.info('Customer deleted from registry', { customerId, garageId });
  return true;
};
