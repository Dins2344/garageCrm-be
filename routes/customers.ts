import express from 'express';
const router = express.Router();
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  exportCustomers
} from '../controllers/customerController';
import { protect, authorize } from '../middleware/auth';

router.use(protect);

router.route('/')
  .get(getCustomers)
  .post(authorize('owner', 'admin', 'service_advisor', 'receptionist'), createCustomer);

// Before '/:id', or "export" is read as an id.
router.get('/export', authorize('owner', 'admin'), exportCustomers);

router.route('/:id')
  .get(getCustomer)
  .put(authorize('owner', 'admin', 'service_advisor', 'receptionist'), updateCustomer)
  .delete(authorize('owner', 'admin'), deleteCustomer);

export default router;
