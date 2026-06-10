const dashboardUsecase = require('../usecases/dashboardUsecase');
const logger = require('../utils/logger');
const log = logger.child('DashboardController');

// @desc    Get dashboard stats
// @route   GET /api/dashboard
exports.getDashboardStats = async (req, res, next) => {
  try {
    const stats = await dashboardUsecase.compileStats({
      garageId: req.user.garage._id
    });

    log.info('Dashboard stats compiled successfully', { 
      garageId: req.user.garage._id, 
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
exports.getChartData = async (req, res, next) => {
  try {
    const { startDate, endDate, groupBy = 'day' } = req.query;

    const start = startDate ? new Date(startDate) : (() => {
      const d = new Date(); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d;
    })();
    const end = endDate ? new Date(new Date(endDate).setHours(23, 59, 59, 999)) : new Date();

    log.info('Fetching chart data', { garageId: req.user.garage._id, start, end, groupBy });

    const data = await dashboardUsecase.getChartData({
      garageId: req.user.garage._id,
      startDate: start,
      endDate: end,
      groupBy
    });

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

