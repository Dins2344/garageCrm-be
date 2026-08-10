import bcrypt from 'bcryptjs';
import { Types } from 'mongoose';
import User, { IUser } from '../models/User';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('UserUsecase');

interface ListInput {
  garageId: Types.ObjectId | string;
}

export const getStaffList = async ({ garageId }: ListInput) => {
  log.info('Fetching staff list', { garageId });
  const users = await User.find({ garage: garageId }).lean();
  log.info('Staff list fetched', { garageId, count: users.length });
  return users;
};

interface GetByIdInput {
  staffId: string;
  garageId: Types.ObjectId | string;
}

export const getStaffMember = async ({ staffId, garageId }: GetByIdInput) => {
  log.info('Fetching staff member', { staffId, garageId });
  const user = await User.findOne({ _id: staffId, garage: garageId }).lean();
  if (!user) {
    log.warn('Staff member not found', { staffId, garageId });
    throw new HttpError('User not found', 404);
  }
  return user;
};

interface RegisterInput {
  staffData: Partial<IUser>;
  garageId: Types.ObjectId | string;
}

export const registerStaff = async ({ staffData, garageId }: RegisterInput) => {
  log.info('Registering new staff member', { garageId, role: staffData.role, email: staffData.email });
  const dataWithGarage = { ...staffData, garage: garageId };
  const user = await User.create(dataWithGarage);
  log.info('New staff registered', { userId: user._id, role: user.role, garageId });
  return user;
};

interface UpdateInput {
  staffId: string;
  garageId: Types.ObjectId | string;
  updateData: Partial<IUser>;
}

export const updateStaffDetails = async ({ staffId, garageId, updateData }: UpdateInput) => {
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
    throw new HttpError('User not found', 404);
  }

  log.info('Staff details updated', { staffId });
  return user;
};

interface DeactivateInput {
  staffId: string;
  garageId: Types.ObjectId | string;
  action: string;
}

export const deactivateStaff = async ({ staffId, garageId, action }: DeactivateInput) => {
  log.info('Toggling staff account status', { staffId, garageId, action });
  const user = await User.findOne({ _id: staffId, garage: garageId });

  if (!user) {
    log.warn('Staff member not found for status toggle', { staffId, garageId });
    throw new HttpError('User not found', 404);
  }

  user.isActive = action === 'activate';
  await user.save();

  log.info(`Staff account ${user.isActive ? 'activated' : 'deactivated'}`, { staffId, garageId });
  return user;
};

interface RemoveInput {
  staffId: string;
  garageId: Types.ObjectId | string;
}

export const removeStaff = async ({ staffId, garageId }: RemoveInput): Promise<true> => {
  log.info('Removing staff member', { staffId, garageId });
  const user = await User.findOneAndDelete({ _id: staffId, garage: garageId });
  if (!user) {
    log.warn('Staff member not found for deletion', { staffId, garageId });
    throw new HttpError('User not found', 404);
  }
  log.info('Staff member removed', { staffId, garageId });
  return true;
};
