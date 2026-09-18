import express from 'express';
const router = express.Router();
import { getDashboardStats, getChartData, getMonthlyMetrics } from '../controllers/dashboardController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.get('/', protect, asyncHandler(getDashboardStats));
router.get('/charts', protect, asyncHandler(getChartData));
// Profit is owner/admin information, like the expenses that feed it.
router.get('/monthly', protect, authorize('owner', 'admin'), asyncHandler(getMonthlyMetrics));

export default router;
