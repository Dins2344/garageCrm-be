import User, { IUser } from '../models/User';
import Garage from '../models/Garage';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { Role } from '../types/domain';

const log = logger.child('AuthUsecase');

interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  garageName?: string;
  garagePhone?: string;
  garageAddress?: Record<string, unknown>;
}

export const registerNewGarage = async (userData: RegisterInput): Promise<{ user: IUser; token: string }> => {
  const { name, email, phone, password, garageName, garagePhone, garageAddress } = userData;

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new HttpError('Email already registered', 400);
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
    role: 'owner' as Role,
    garage: garage._id
  });

  // 3. Update Garage with owner ID
  garage.owner = user._id;
  await garage.save();

  log.info('New garage and owner registered', { garageId: garage._id, userId: user._id });

  const token = user.getSignedJwtToken();
  return { user, token };
};

interface AuthenticateInput {
  email: string;
  password: string;
}

export const authenticateUser = async ({ email, password }: AuthenticateInput): Promise<{ user: IUser; token: string }> => {
  if (!email || !password) {
    throw new HttpError('Please provide email and password', 400);
  }

  // Check for user
  const user = await User.findOne({ email }).select('+password').populate('garage');
  if (!user) {
    throw new HttpError('Invalid credentials', 401);
  }

  // Check if password matches
  const isMatch = await user.matchPassword(password);
  if (!isMatch) {
    throw new HttpError('Invalid credentials', 401);
  }

  // Check if user is active
  if (!user.isActive) {
    throw new HttpError('Account has been deactivated', 403);
  }

  log.info('User authenticated successfully', { userId: user._id, role: user.role });

  const token = user.getSignedJwtToken();
  return { user, token };
};

interface UpdateProfileInput {
  userId: string;
  updateData: Partial<Pick<IUser, 'name' | 'phone'>>;
}

export const updateUserProfile = async ({ userId, updateData }: UpdateProfileInput): Promise<IUser | null> => {
  const user = await User.findByIdAndUpdate(userId, updateData, {
    new: true,
    runValidators: true
  });
  return user;
};

interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export const changeUserPassword = async ({ userId, currentPassword, newPassword }: ChangePasswordInput): Promise<true> => {
  const user = await User.findById(userId).select('+password');

  if (!user || !(await user.matchPassword(currentPassword))) {
    throw new HttpError('Current password is incorrect', 401);
  }

  user.password = newPassword;
  await user.save();
  return true;
};
