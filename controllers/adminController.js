const adminUsecase = require('../usecases/adminUsecase');
const logger = require('../utils/logger');
const log = logger.child('AdminController');

// @desc    Admin login — returns a short-lived JWT
// @route   POST /api/admin/login
exports.login = (req, res, next) => {
  try {
    const { email, password } = req.body;
    log.info('Admin login request received', { email });
    const { token, admin } = adminUsecase.adminLogin({ email, password });
    res.json({ success: true, token, data: admin });
  } catch (error) {
    log.error('Admin login error', { error: error.message });
    next(error);
  }
};

// @desc    Verify admin token
// @route   GET /api/admin/verify
exports.verify = (req, res) => {
  // If we reach here, adminAuth middleware already validated the token
  log.info('Admin token verified', { email: req.admin?.email });
  res.json({ success: true, data: req.admin });
};

// @desc    Get platform-wide stats
// @route   GET /api/admin/stats
exports.getStats = async (req, res, next) => {
  try {
    log.info('Admin stats request', { adminEmail: req.admin?.email });
    const stats = await adminUsecase.getSystemStats();
    log.info('Admin stats served', { queryTimeMs: stats.queryTimeMs });
    res.json({ success: true, data: stats });
  } catch (error) {
    log.error('Failed to compile admin stats', { error: error.message });
    next(error);
  }
};

// @desc    Get all garages with enriched counts & revenue
// @route   GET /api/admin/garages
exports.getGarages = async (req, res, next) => {
  try {
    log.info('Admin all-garages request', { adminEmail: req.admin?.email });
    const garages = await adminUsecase.getAllGarages();
    log.info('All garages served', { count: garages.length });
    res.json({ success: true, data: garages });
  } catch (error) {
    log.error('Failed to fetch all garages', { error: error.message });
    next(error);
  }
};

// @desc    Get all users across all garages
// @route   GET /api/admin/users
exports.getUsers = async (req, res, next) => {
  try {
    log.info('Admin all-users request', { adminEmail: req.admin?.email });
    const users = await adminUsecase.getAllUsers();
    log.info('All platform users served', { count: users.length });
    res.json({ success: true, data: users });
  } catch (error) {
    log.error('Failed to fetch all users', { error: error.message });
    next(error);
  }
};

// @desc    System health info
// @route   GET /api/admin/health
exports.getHealth = (req, res, next) => {
  try {
    log.info('Admin health check', { adminEmail: req.admin?.email });
    const health = adminUsecase.getHealthInfo();
    res.json({ success: true, data: health });
  } catch (error) {
    log.error('Failed to get health info', { error: error.message });
    next(error);
  }
};
