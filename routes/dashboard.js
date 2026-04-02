const express = require('express');
const router = express.Router();
const { getDashboardStats } = require('../controllers/dashboardController');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

router.get('/', protect, asyncHandler(getDashboardStats));

module.exports = router;
