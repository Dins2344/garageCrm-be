const express = require('express');
const router = express.Router();
const {
  getReminders,
  getUpcoming,
  createReminder,
  updateStatus,
  deleteReminder,
  triggerCron
} = require('../controllers/reminderController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

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

module.exports = router;


