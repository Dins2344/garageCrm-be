import crypto from 'crypto';
import mongoose from 'mongoose';
import User, { IUser } from '../models/User';
import Garage from '../models/Garage';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { Role } from '../types/domain';
import { COUNTRIES, DEFAULT_COUNTRY, isSupportedCountry } from '../config/countries';
import { isValidPhoneForCountry } from '../utils/phone';
import { isValidTimezone } from '../utils/locale';
import { sendPasswordResetEmail } from '../services/emailService';

const log = logger.child('AuthUsecase');

interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  garageName?: string;
  garagePhone?: string;
  garageAddress?: Record<string, unknown>;
  country?: string;
  /** Only meaningful for countries spanning several zones (US/CA/AU). */
  timezone?: string;
}

export const registerNewGarage = async (userData: RegisterInput): Promise<{ user: IUser; token: string }> => {
  const { name, email, phone, password, garageName, garagePhone, garageAddress } = userData;

  // Default to India so existing clients that don't send a country keep the
  // behaviour they've always had.
  const requestedCountry = userData.country?.toUpperCase();
  if (requestedCountry && !isSupportedCountry(requestedCountry)) {
    throw new HttpError(`Unsupported country: ${requestedCountry}`, 400);
  }
  const country = isSupportedCountry(requestedCountry) ? requestedCountry : DEFAULT_COUNTRY;
  const countryDefaults = COUNTRIES[country];

  // Country-aware phone validation lives here, not on the schema: the User
  // model can't see which country the garage is being created in at validate
  // time. It also restores a check India lost — the old schema regex
  // `/^[6-9]\d{9}$/` was deliberately loosened so non-Indian numbers could be
  // stored, which left nothing rejecting malformed input. This is the only
  // gate, so it has to be here rather than nowhere.
  if (!isValidPhoneForCountry(phone, country)) {
    throw new HttpError(
      `Please enter a valid phone number for ${countryDefaults.name} (e.g. ${countryDefaults.phoneExample}).`,
      400
    );
  }
  if (garagePhone && !isValidPhoneForCountry(garagePhone, country)) {
    throw new HttpError(
      `Please enter a valid garage phone number for ${countryDefaults.name} (e.g. ${countryDefaults.phoneExample}).`,
      400
    );
  }

  // Ignored for single-zone countries — the country table is authoritative
  // there, and storing a redundant override would freeze it against fixes.
  const timezone =
    countryDefaults.timezone === null && userData.timezone ? userData.timezone.trim() : '';
  if (timezone && !isValidTimezone(timezone)) {
    throw new HttpError(`Unrecognised timezone: ${userData.timezone}`, 400);
  }

  // Check if user exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw new HttpError('Email already registered', 400);
  }

  // Create User first, referencing a pre-generated Garage id, then create the
  // Garage with `owner` already set in the same call — so the two documents
  // are never in an inconsistent state relative to each other. Previously
  // this created the Garage first and linked `owner` afterwards in a third
  // step; if User.create() failed in between (a validation error, or two
  // concurrent signups racing past the duplicate-email check above and both
  // colliding on the unique index), the Garage was already committed and
  // left permanently ownerless. This ordering means a User.create() failure
  // happens before anything else exists, and a Garage.create() failure rolls
  // back the User — either both exist and are linked, or neither does.
  const garageId = new mongoose.Types.ObjectId();
  const user = await User.create({
    name,
    email,
    phone,
    password,
    role: 'owner' as Role,
    garage: garageId
  });

  let garage;
  try {
    garage = await Garage.create({
      _id: garageId,
      name: garageName || `${name}'s Garage`,
      phone: garagePhone || phone,
      address: garageAddress || {},
      owner: user._id,
      country,
      // Seeded once from the country, then owned by the garage — see the note
      // in config/countries.ts on why these must not track the table.
      settings: {
        taxRate: countryDefaults.defaultTaxRate,
        laborRatePerHour: countryDefaults.defaultLaborRatePerHour,
        // Only stored when the country has no single zone of its own; for
        // everywhere else '' means "inherit from the country table", so a
        // later correction to that table reaches existing garages.
        ...(timezone ? { timezone } : {})
      }
    });
  } catch (err) {
    await User.findByIdAndDelete(user._id);
    throw err;
  }

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

  // Check for user. Deliberately NOT populating `garage` here — the client-side
  // User type (web and mobile) expects garage as a plain id string, matching
  // what /auth/register already returns; populating it silently breaks any
  // string comparison against garage ids (e.g. the mobile branch switcher).
  const user = await User.findOne({ email }).select('+password');
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

interface ForgotPasswordInput {
  email: string;
  frontendUrl: string;
}

type ForgotPasswordStatus = 'sent' | 'staff-managed' | 'not-found';

/**
 * Only owners can self-service reset their password by email — staff accounts
 * are managed by their garage's owner (who can already set a new password for
 * them directly via the Edit Staff flow), so this deliberately does not issue
 * a token for non-owner roles. The caller maps the status to a user-facing
 * message; 'sent' and 'not-found' should render identically so this endpoint
 * can't be used to enumerate valid owner emails.
 */
export const forgotPassword = async ({ email, frontendUrl }: ForgotPasswordInput): Promise<{ status: ForgotPasswordStatus }> => {
  const user = await User.findOne({ email });
  if (!user) {
    return { status: 'not-found' };
  }
  if (user.role !== 'owner') {
    return { status: 'staff-managed' };
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  user.resetPasswordExpire = new Date(Date.now() + 30 * 60 * 1000);
  await user.save();

  await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    resetUrl: `${frontendUrl}/reset-password/${rawToken}`
  });

  log.info('Password reset email sent', { userId: user._id });
  return { status: 'sent' };
};

interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export const resetPassword = async ({ token, newPassword }: ResetPasswordInput): Promise<true> => {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpire: { $gt: new Date() }
  }).select('+resetPasswordToken +resetPasswordExpire');

  if (!user) {
    throw new HttpError('This reset link is invalid or has expired.', 400);
  }

  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  await user.save();

  log.info('Password reset successfully', { userId: user._id });
  return true;
};
