import { Request, Response, NextFunction } from 'express';
import * as dashboardUsecase from '../usecases/dashboardUsecase';
import logger from '../utils/logger';
const log = logger.child('DashboardController');

// @desc    Get dashboard stats
// @route   GET /api/dashboard
export const getDashboardStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const stats = await dashboardUsecase.compileStats({
      garageId: req.garageId!
    });

    log.info('Dashboard stats compiled successfully', {
      garageId: req.garageId!,
      queryTimeMs: stats.queryTimeMs
    });

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get chart data for a custom date range
// @route   GET /api/dashboard/charts?startDate=&endDate=&groupBy=day|week|month
export const getChartData = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query as { startDate?: string; endDate?: string; groupBy?: 'day' | 'week' | 'month' };

    const start = startDate ? new Date(startDate) : (() => {
      const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d;
    })();
    const end = endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : new Date();

    log.info('Fetching chart data', { garageId: req.garageId!, start, end, groupBy });

    const data = await dashboardUsecase.getChartData({
      garageId: req.garageId!,
      startDate: start,
      endDate: end,
      groupBy
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
