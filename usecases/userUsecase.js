const User = require('../models/User');
const bcrypt = require('bcryptjs');
const logger = require('../utils/logger');
const log = logger.child('UserUsecase');

exports.getStaffList = async ({ garageId }) => {
  log.info('Fetching staff list', { garageId });
  const users = await User.find({ garage: garageId }).lean();
  log.info('Staff list fetched', { garageId, count: users.length });
  return users;
};

exports.registerStaff = async ({ staffData, garageId }) => {
  log.info('Registering new staff member', { garageId, role: staffData.role, email: staffData.email });
  staffData.garage = garageId;
  const user = await User.create(staffData);
  log.info('New staff registered', { userId: user._id, role: user.role, garageId });
  return user;
};

exports.updateStaffDetails = async ({ staffId, garageId, updateData }) => {
  log.info('Updating staff details', { staffId, garageId, fields: Object.keys(updateData) });

  // findOneAndUpdate bypasses the pre('save') bcrypt hook, so we hash manually
  if (updateData.password) {
    const salt = await bcrypt.genSalt(12);
    updateData.password = await bcrypt.hash(updateData.password, salt);
    log.info('Password hashed before staff update', { staffId });
  }

  const user = await User.findOneAndUpdate(
    { _id: staffId, garage: garageId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!user) {
    log.warn('Staff member not found for update', { staffId, garageId });
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }

  log.info('Staff details updated', { staffId });
  return user;
};

exports.deactivateStaff = async ({ staffId, garageId, action }) => {
  log.info('Toggling staff account status', { staffId, garageId, action });
  const user = await User.findOne({ _id: staffId, garage: garageId });

  if (!user) {
    log.warn('Staff member not found for status toggle', { staffId, garageId });
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
  log.info('Removing staff member', { staffId, garageId });
  const user = await User.findOneAndDelete({ _id: staffId, garage: garageId });
  if (!user) {
    log.warn('Staff member not found for deletion', { staffId, garageId });
    const error = new Error('User not found');
    error.statusCode = 404;
    throw error;
  }
  log.info('Staff member removed', { staffId, garageId });
  return true;
};
