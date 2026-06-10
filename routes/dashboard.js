const express = require('express');
const router = express.Router();
const { getDashboardStats, getChartData } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/', protect, asyncHandler(getDashboardStats));
router.get('/charts', protect, asyncHandler(getChartData));

module.exports = router;
