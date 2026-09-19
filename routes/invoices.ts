import express from 'express';
const router = express.Router();
import {
  getInvoices,
  getInvoice,
  createInvoice,
  updatePaymentStatus,
  deleteInvoice,
  downloadInvoicePDF
} from '../controllers/invoiceController';
import { protect, authorize } from '../middleware/auth';

router.use(protect);

router.route('/')
  .get(getInvoices)
  .post(authorize('owner', 'admin', 'service_advisor'), createInvoice);

router.route('/:id')
  .get(getInvoice)
  .delete(authorize('owner', 'admin'), deleteInvoice);

router.get('/:id/pdf', downloadInvoicePDF);
router.put('/:id/payment', authorize('owner', 'admin', 'service_advisor'), updatePaymentStatus);

export default router;
