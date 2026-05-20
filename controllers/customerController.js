const customerUsecase = require('../usecases/customerUsecase');
const logger = require('../utils/logger');
const log = logger.child('CustomerController');

// @desc    Get all customers — Thin Controller
// @route   GET /api/customers
exports.getCustomers = async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;
    const garageId = req.user.garage._id;
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
    log.error('Failed to fetch customers', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};

// @desc    Get single customer
// @route   GET /api/customers/:id
exports.getCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Fetching single customer', { customerId: id, garageId });
    const customer = await customerUsecase.getCustomerById({ customerId: id, garageId });
    log.info('Customer fetched', { customerId: id });
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    log.error('Failed to fetch customer', { customerId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Create customer
// @route   POST /api/customers
exports.createCustomer = async (req, res, next) => {
  try {
    const garageId = req.user.garage._id;
    log.info('Creating new customer', { garageId, phone: req.body.phone });
    const customer = await customerUsecase.saveCustomer({ customerData: req.body, garageId });
    log.info('Customer created', { customerId: customer._id, garageId });
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    log.error('Failed to create customer', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};

// @desc    Update customer
// @route   PUT /api/customers/:id
exports.updateCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Updating customer', { customerId: id, garageId, fields: Object.keys(req.body) });
    const customer = await customerUsecase.updateCustomerData({ customerId: id, garageId, updateData: req.body });
    log.info('Customer updated', { customerId: id });
    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    log.error('Failed to update customer', { customerId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Delete customer
// @route   DELETE /api/customers/:id
exports.deleteCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Deleting customer', { customerId: id, garageId });
    await customerUsecase.removeCustomer({ customerId: id, garageId });
    log.info('Customer deleted', { customerId: id, garageId });
    res.status(200).json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    log.error('Failed to delete customer', { customerId: req.params.id, error: error.message });
    next(error);
  }
};
