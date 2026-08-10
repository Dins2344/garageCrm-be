import express from 'express';
const router = express.Router();
import {
  getJobCards,
  getJobCard,
  createJobCard,
  updateJobCard,
  updateEstimation,
  approveEstimation,
  deleteJobCard,
  downloadEstimation
} from '../controllers/jobCardController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.use(protect);

router.get('/:id/estimation/download', authorize('owner', 'admin', 'service_advisor', 'receptionist'), asyncHandler(downloadEstimation));

router.route('/')
  .get(asyncHandler(getJobCards))
  .post(authorize('owner', 'admin', 'service_advisor'), asyncHandler(createJobCard));

router.route('/:id')
  .get(asyncHandler(getJobCard))
  .put(asyncHandler(updateJobCard))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteJobCard));

router.put('/:id/estimation', authorize('owner', 'admin', 'service_advisor'), asyncHandler(updateEstimation));
router.put('/:id/approve', authorize('owner', 'admin', 'service_advisor'), asyncHandler(approveEstimation));

export default router;
