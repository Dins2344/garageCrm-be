const express = require('express');
const router = express.Router();
const {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer
} = require('../controllers/customerController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

router.use(protect);

router.route('/')
  .get(asyncHandler(getCustomers))
  .post(authorize('owner', 'admin', 'service_advisor', 'receptionist'), asyncHandler(createCustomer));

router.route('/:id')
  .get(asyncHandler(getCustomer))
  .put(authorize('owner', 'admin', 'service_advisor', 'receptionist'), asyncHandler(updateCustomer))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteCustomer));

module.exports = router;
