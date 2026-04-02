const express = require('express');
const router = express.Router();
const {
  getReminders,
  getUpcoming,
  createReminder,
  updateStatus,
  deleteReminder
} = require('../controllers/reminderController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');
const { processServiceReminders } = require('../services/cronScheduler');

router.use(protect);

router.get('/upcoming', asyncHandler(getUpcoming));

// Manual trigger for testing the cron job (owner/admin only)
router.post('/trigger-cron', authorize('owner', 'admin'), asyncHandler(async (req, res) => {
  const result = await processServiceReminders();
  res.status(200).json({ success: true, message: 'Reminder cron triggered manually', data: result });
}));

router.route('/')
  .get(asyncHandler(getReminders))
  .post(authorize('owner', 'admin', 'service_advisor'), asyncHandler(createReminder));

router.route('/:id')
  .patch(authorize('owner', 'admin', 'service_advisor'), asyncHandler(updateStatus))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteReminder));

module.exports = router;

