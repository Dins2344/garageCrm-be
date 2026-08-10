const authUsecase = require('../usecases/authUsecase');
const logger = require('../utils/logger');
const log = logger.child('AuthController');

// Helper to send formatted token response
const sendTokenResponse = (user, statusCode, res) => {
  const token = user.getSignedJwtToken();

  const options = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  };

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      token, // Kept for mobile app backward compatibility
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
    log.info('New garage registration attempt', { email: req.body.email, garageName: req.body.garageName });
    const { user } = await authUsecase.registerNewGarage(req.body);
    log.info('New garage registered successfully', { userId: user._id, garageId: user.garage });
    sendTokenResponse(user, 201, res);
  } catch (error) {
    log.error('Garage registration failed', { email: req.body.email, error: error.message });
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
exports.login = async (req, res, next) => {
  try {
    log.info('Login attempt', { email: req.body.email, ip: req.ip });
    const { user } = await authUsecase.authenticateUser({
      email: req.body.email,
      password: req.body.password
    });
    log.info('Login successful', { userId: user._id, role: user.role });
    sendTokenResponse(user, 200, res);
  } catch (error) {
    log.warn('Login failed', { email: req.body.email, error: error.message });
    next(error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
exports.getMe = async (req, res, next) => {
  try {
    log.info('Me request', { userId: req.user._id, role: req.user.role });
    // req.user is already populated by auth middleware
    res.status(200).json({ success: true, data: req.user });
  } catch (error) {
    log.error('Failed to get current user', { error: error.message });
    next(error);
  }
};

// @desc    Update profile
// @route   PUT /api/auth/profile
exports.updateProfile = async (req, res, next) => {
  try {
    log.info('Profile update request', { userId: req.user._id });
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

    log.info('Profile updated', { userId: req.user._id, fields: Object.keys(fieldsToUpdate) });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    log.error('Profile update failed', { userId: req.user?._id, error: error.message });
    next(error);
  }
};

// @desc    Update password
// @route   PUT /api/auth/updatepassword
exports.updatePassword = async (req, res, next) => {
  try {
    log.info('Password change request', { userId: req.user._id });
    await authUsecase.changeUserPassword({
      userId: req.user._id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword
    });
    log.info('Password changed successfully', { userId: req.user._id });
    res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    log.warn('Password change failed', { userId: req.user?._id, error: error.message });
    next(error);
  }
};

// @desc    Log user out / clear cookie
// @route   POST /api/auth/logout
exports.logout = (req, res, next) => {
  log.info('User logout requested');
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    data: {}
  });
};
