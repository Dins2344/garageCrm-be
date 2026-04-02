const express = require('express');
const router = express.Router();
const {
  getJobCards,
  getJobCard,
  createJobCard,
  updateJobCard,
  updateEstimation,
  approveEstimation,
  deleteJobCard
} = require('../controllers/jobCardController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

router.use(protect);

router.route('/')
  .get(asyncHandler(getJobCards))
  .post(authorize('owner', 'admin', 'service_advisor'), asyncHandler(createJobCard));

router.route('/:id')
  .get(asyncHandler(getJobCard))
  .put(asyncHandler(updateJobCard))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteJobCard));

router.put('/:id/estimation', authorize('owner', 'admin', 'service_advisor'), asyncHandler(updateEstimation));
router.put('/:id/approve', authorize('owner', 'admin', 'service_advisor'), asyncHandler(approveEstimation));

module.exports = router;
