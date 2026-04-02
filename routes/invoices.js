const express = require('express');
const router = express.Router();
const {
  getInvoices,
  getInvoice,
  createInvoice,
  updatePaymentStatus,
  deleteInvoice,
  downloadInvoicePDF
} = require('../controllers/invoiceController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

router.use(protect);

router.route('/')
  .get(asyncHandler(getInvoices))
  .post(authorize('owner', 'admin', 'service_advisor'), asyncHandler(createInvoice));

router.route('/:id')
  .get(asyncHandler(getInvoice))
  .delete(authorize('owner'), asyncHandler(deleteInvoice));

router.get('/:id/pdf', asyncHandler(downloadInvoicePDF));
router.put('/:id/payment', authorize('owner', 'admin', 'service_advisor'), asyncHandler(updatePaymentStatus));

module.exports = router;

