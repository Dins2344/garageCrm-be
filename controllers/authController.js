const authUsecase = require('../usecases/authUsecase');
const logger = require('../utils/logger');
const log = logger.child('AuthController');

// Helper to send formatted token response
const sendTokenResponse = (user, statusCode, res) => {
  const token = user.getSignedJwtToken();
  res.status(statusCode).json({
    success: true,
    token,
    data: {
      _id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      garage: user.garage
    }
  });
};

// @desc    Register owner & create garage
// @route   POST /api/auth/register
exports.register = async (req, res, next) => {
  try {
    const { user } = await authUsecase.registerNewGarage(req.body);
    sendTokenResponse(user, 201, res);
  } catch (error) {
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    const { user } = await authUsecase.authenticateUser({ 
      email: req.body.email, 
      password: req.body.password 
    });
    sendTokenResponse(user, 200, res);
  } catch (error) {
    next(error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
exports.getMe = async (req, res, next) => {
  try {
    // req.user is already populated by auth middleware
    res.status(200).json({ success: true, data: req.user });
  } catch (error) {
    next(error);
  }
};

// @desc    Update profile
// @route   PUT /api/auth/profile
exports.updateProfile = async (req, res, next) => {
  try {
    const fieldsToUpdate = {
      name: req.body.name,
      phone: req.body.phone
    };

    // Remove undefined fields
    Object.keys(fieldsToUpdate).forEach(key =>
      fieldsToUpdate[key] === undefined && delete fieldsToUpdate[key]
    );

    const user = await authUsecase.updateUserProfile({
      userId: req.user._id,
      updateData: fieldsToUpdate
    });

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

// @desc    Update password
// @route   PUT /api/auth/updatepassword
exports.updatePassword = async (req, res, next) => {
  try {
    await authUsecase.changeUserPassword({
      userId: req.user._id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword
    });

    res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    next(error);
  }
};
