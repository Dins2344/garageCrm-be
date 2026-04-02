const User = require('../models/User');
const logger = require('../utils/logger');
const log = logger.child('UserUsecase');

exports.getStaffList = async ({ garageId }) => {
  const users = await User.find({ garage: garageId }).lean();
  return users;
};

exports.registerStaff = async ({ staffData, garageId }) => {
  staffData.garage = garageId;
  const user = await User.create(staffData);
  log.info('New staff registered', { userId: user._id, role: user.role, garageId });
  return user;
};

exports.updateStaffDetails = async ({ staffId, garageId, updateData }) => {
  const user = await User.findOneAndUpdate(
    { _id: staffId, garage: garageId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  return user;
};

exports.deactivateStaff = async ({ staffId, garageId, action }) => {
  const user = await User.findOne({ _id: staffId, garage: garageId });

  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  user.isActive = action === 'activate';
  await user.save();

  log.info(`Staff account ${user.isActive ? 'activated' : 'deactivated'}`, { staffId, garageId });
  return user;
};

exports.removeStaff = async ({ staffId, garageId }) => {
  const user = await User.findOneAndDelete({ _id: staffId, garage: garageId });
  if (!user) {
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }
  return true;
};
