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
