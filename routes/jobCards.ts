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

router.use(protect);

router.get('/:id/estimation/download', authorize('owner', 'admin', 'service_advisor', 'receptionist'), downloadEstimation);

router.route('/')
  .get(getJobCards)
  .post(authorize('owner', 'admin', 'service_advisor'), createJobCard);

router.route('/:id')
  .get(getJobCard)
  .put(updateJobCard)
  .delete(authorize('owner', 'admin'), deleteJobCard);

router.put('/:id/estimation', authorize('owner', 'admin', 'service_advisor'), updateEstimation);
router.put('/:id/approve', authorize('owner', 'admin', 'service_advisor'), approveEstimation);

export default router;
