const express = require('express');
const router = express.Router();
const { getGarage, updateGarage } = require('../controllers/garageController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

router.use(protect);

router.route('/')
  .get(asyncHandler(getGarage))
  .put(authorize('owner', 'admin'), asyncHandler(updateGarage));

module.exports = router;

