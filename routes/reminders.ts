import express from 'express';
const router = express.Router();
import {
  getReminders,
  getUpcoming,
  createReminder,
  updateStatus,
  deleteReminder,
  triggerCron
} from '../controllers/reminderController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.use(protect);

router.get('/upcoming', asyncHandler(getUpcoming));

// Manual cron trigger (owner/admin only) — logic lives in controller, not here
router.post('/trigger-cron', authorize('owner', 'admin'), asyncHandler(triggerCron));

router.route('/')
  .get(asyncHandler(getReminders))
  .post(authorize('owner', 'admin', 'service_advisor'), asyncHandler(createReminder));

router.route('/:id')
  .patch(authorize('owner', 'admin', 'service_advisor'), asyncHandler(updateStatus))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteReminder));

export default router;
