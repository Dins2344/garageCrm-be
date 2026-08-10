import express from 'express';
const router = express.Router();
import { getDashboardStats, getChartData } from '../controllers/dashboardController';
import { protect } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.get('/', protect, asyncHandler(getDashboardStats));
router.get('/charts', protect, asyncHandler(getChartData));

export default router;
