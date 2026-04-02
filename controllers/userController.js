const userUsecase = require('../usecases/userUsecase');
const logger = require('../utils/logger');
const log = logger.child('UserController');

// @desc    Get all staff/users
// @route   GET /api/users
exports.getUsers = async (req, res, next) => {
  try {
    const users = await userUsecase.getStaffList({
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, count: users.length, data: users });
  } catch (error) {
    next(error);
  }
};

// @desc    Create staff member
// @route   POST /api/users
exports.createUser = async (req, res, next) => {
  try {
    // Only owner and admin can create users
    const user = await userUsecase.registerStaff({
      staffData: req.body,
      garageId: req.user.garage._id
    });
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Update user
// @route   PUT /api/users/:id
exports.updateUser = async (req, res, next) => {
  try {
    const user = await userUsecase.updateStaffDetails({
      staffId: req.params.id,
      garageId: req.user.garage._id,
      updateData: req.body
    });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Activate/Deactivate user
// @route   PATCH /api/users/:id/:action
exports.toggleUserStatus = async (req, res, next) => {
  try {
    const user = await userUsecase.deactivateStaff({
      staffId: req.params.id,
      garageId: req.user.garage._id,
      action: req.params.action // 'activate' or 'deactivate'
    });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete user
// @route   DELETE /api/users/:id
exports.deleteUser = async (req, res, next) => {
  try {
    await userUsecase.removeStaff({
      staffId: req.params.id,
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    next(error);
  }
};
