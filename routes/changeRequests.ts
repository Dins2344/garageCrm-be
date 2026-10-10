import express from 'express';
const router = express.Router();
import {
  createChangeRequest, getChangeRequests, getChangeRequest, withdrawChangeRequest,
  approveChangeRequest, rejectChangeRequest
} from '../controllers/changeRequestController';
import { protect, authorize } from '../middleware/auth';

router.use(protect);

// Owners and admins make these changes directly, so only staff raise requests.
router.route('/')
  .get(getChangeRequests)
  .post(authorize('service_advisor', 'mechanic', 'receptionist'), createChangeRequest);

router.get('/:id', getChangeRequest);
router.put('/:id/approve', authorize('owner', 'admin'), approveChangeRequest);
router.put('/:id/reject', authorize('owner', 'admin'), rejectChangeRequest);
router.put('/:id/withdraw', withdrawChangeRequest);

export default router;
