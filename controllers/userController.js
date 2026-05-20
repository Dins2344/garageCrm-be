const userUsecase = require('../usecases/userUsecase');
const logger = require('../utils/logger');
const log = logger.child('UserController');

// @desc    Get all staff/users
// @route   GET /api/users
exports.getUsers = async (req, res, next) => {
  try {
    const garageId = req.user.garage._id;
    log.info('Fetching staff list', { garageId });
    const users = await userUsecase.getStaffList({ garageId });
    log.info('Staff list fetched', { garageId, count: users.length });
    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    log.error('Failed to fetch staff list', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};

// @desc    Create staff member
// @route   POST /api/users
exports.createUser = async (req, res, next) => {
  try {
    const garageId = req.user.garage._id;
    log.info('Creating staff member', { garageId, role: req.body.role, email: req.body.email });
    // Only owner and admin can create users
    const user = await userUsecase.registerStaff({ staffData: req.body, garageId });
    log.info('Staff member created', { userId: user._id, role: user.role, garageId });
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    log.error('Failed to create staff member', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
exports.updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Updating staff member', { staffId: id, garageId, fields: Object.keys(req.body) });
    const user = await userUsecase.updateStaffDetails({ staffId: id, garageId, updateData: req.body });
    log.info('Staff member updated', { staffId: id });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    log.error('Failed to update staff member', { staffId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Activate/Deactivate user
// @route   PATCH /api/users/:id/:action
exports.toggleUserStatus = async (req, res, next) => {
  try {
    const { id, action } = req.params;
    const garageId = req.user.garage._id;
    log.info('Toggling staff status', { staffId: id, garageId, action });
    const user = await userUsecase.deactivateStaff({ staffId: id, garageId, action });
    log.info('Staff status toggled', { staffId: id, isActive: user.isActive });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    log.error('Failed to toggle staff status', { staffId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
exports.deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Deleting staff member', { staffId: id, garageId });
    await userUsecase.removeStaff({ staffId: id, garageId });
    log.info('Staff member deleted', { staffId: id, garageId });
    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    log.error('Failed to delete staff member', { staffId: req.params.id, error: error.message });
    next(error);
  }
};
