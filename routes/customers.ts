import express from 'express';
const router = express.Router();
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer
} from '../controllers/customerController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.use(protect);

router.route('/')
  .get(asyncHandler(getCustomers))
  .post(authorize('owner', 'admin', 'service_advisor', 'receptionist'), asyncHandler(createCustomer));

router.route('/:id')
  .get(asyncHandler(getCustomer))
  .put(authorize('owner', 'admin', 'service_advisor', 'receptionist'), asyncHandler(updateCustomer))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteCustomer));

export default router;
