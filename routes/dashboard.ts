import express from 'express';
const router = express.Router();
import { getDashboardStats, getChartData, getMonthlyMetrics } from '../controllers/dashboardController';
import { protect, authorize } from '../middleware/auth';

router.get('/', protect, getDashboardStats);
router.get('/charts', protect, getChartData);
// Profit is owner/admin information, like the expenses that feed it.
router.get('/monthly', protect, authorize('owner', 'admin'), getMonthlyMetrics);

export default router;
