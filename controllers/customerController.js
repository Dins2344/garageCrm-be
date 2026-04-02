const customerUsecase = require('../usecases/customerUsecase');
const logger = require('../utils/logger');
const log = logger.child('CustomerController');

// @desc    Get all customers — Thin Controller
// @route   GET /api/customers
exports.getCustomers = async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;
    const garageId = req.user.garage._id;

    const { customers, total, page: currentPage, limit: currentLimit } = await customerUsecase.getCustomersList({
      garageId,
      search,
      page,
      limit
    });

    res.status(200).json({
      success: true,
      count: customers.length,
      total,
      pages: Math.ceil(total / currentLimit),
      currentPage,
      data: customers
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single customer
// @route   GET /api/customers/:id
exports.getCustomer = async (req, res, next) => {
  try {
    const customer = await customerUsecase.getCustomerById({
      customerId: req.params.id,
      garageId: req.user.garage._id
    });

    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
};

// @desc    Create customer
// @route   POST /api/customers
exports.createCustomer = async (req, res, next) => {
  try {
    const customer = await customerUsecase.saveCustomer({
      customerData: req.body,
      garageId: req.user.garage._id
    });

    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
};

// @desc    Update customer
// @route   PUT /api/customers/:id
exports.updateCustomer = async (req, res, next) => {
  try {
    const customer = await customerUsecase.updateCustomerData({
      customerId: req.params.id,
      garageId: req.user.garage._id,
      updateData: req.body
    });

    res.status(200).json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete customer
// @route   DELETE /api/customers/:id
exports.deleteCustomer = async (req, res, next) => {
  try {
    await customerUsecase.removeCustomer({
      customerId: req.params.id,
      garageId: req.user.garage._id
    });

    res.status(200).json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    next(error);
  }
};
