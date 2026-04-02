const User = require('../models/User');
const Garage = require('../models/Garage');
const logger = require('../utils/logger');
const log = logger.child('AuthUsecase');

exports.registerNewGarage = async (userData) => {
  const { name, email, phone, password, garageName, garagePhone, garageAddress } = userData;

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    const error = new Error('Email already registered');
    error.statusCode = 400;
    throw error;
  }

  // 1. Create Garage first
  const garage = await Garage.create({
    name: garageName || `${name}'s Garage`,
    phone: garagePhone || phone,
    address: garageAddress || {}
  });

  // 2. Create User as Owner
  const user = await User.create({
    name,
    email,
    phone,
    password,
    role: 'owner',
    garage: garage._id
  });

  // 3. Update Garage with owner ID
  garage.owner = user._id;
  await garage.save();

  log.info('New garage and owner registered', { garageId: garage._id, userId: user._id });

  const token = user.getSignedJwtToken();
  return { user, token };
};

exports.authenticateUser = async ({ email, password }) => {
  if (!email || !password) {
    const error = new Error('Please provide email and password');
    error.statusCode = 400;
    throw error;
  }

  // Check for user
  const user = await User.findOne({ email }).select('+password').populate('garage');
  if (!user) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  // Check if password matches
  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    const error = new Error('Invalid credentials');
    error.statusCode = 401;
    throw error;
  }

  // Check if user is active
  if (!user.isActive) {
    const error = new Error('Account has been deactivated');
    error.statusCode = 403;
    throw error;
  }

  log.info('User authenticated successfully', { userId: user._id, role: user.role });

  const token = user.getSignedJwtToken();
  return { user, token };
};

exports.updateUserProfile = async ({ userId, updateData }) => {
  const user = await User.findByIdAndUpdate(userId, updateData, {
    new: true,
    runValidators: true
  });
  return user;
};

exports.changeUserPassword = async ({ userId, currentPassword, newPassword }) => {
  const user = await User.findById(userId).select('+password');

  if (!(await user.matchPassword(currentPassword))) {
    const error = new Error('Current password is incorrect');
    error.statusCode = 401;
    throw error;
  }

  user.password = newPassword;
  await user.save();
  return true;
};
