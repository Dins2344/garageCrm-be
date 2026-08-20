import { Request, Response, NextFunction } from 'express';
import * as authUsecase from '../usecases/authUsecase';
import { IUser } from '../models/User';
import Garage from '../models/Garage';
import { resolveGarageLocale } from '../utils/locale';
import logger from '../utils/logger';
const log = logger.child('AuthController');

// Helper to send formatted token response
//
// The `locale` block rides along on every auth response because it's the only
// path a NON-OWNER has to the garage's locale: the mobile GarageContext only
// calls listBranches(), and only for owners, so staff would otherwise have
// nothing to format currency/dates with. One indexed _id lookup.
const sendTokenResponse = async (user: IUser, statusCode: number, res: Response): Promise<void> => {
  const token = user.getSignedJwtToken();

  const garage = await Garage.findById(user.garage).select('country settings').lean();

  const options = {
    expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
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
        garage: user.garage,
        locale: resolveGarageLocale(garage)
      }
    });
};

// @desc    Register owner & create garage
// @route   POST /api/auth/register
export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('New garage registration attempt', { email: req.body.email, garageName: req.body.garageName });
    const { user } = await authUsecase.registerNewGarage(req.body);
    log.info('New garage registered successfully', { userId: user._id, garageId: user.garage });
    await sendTokenResponse(user, 201, res);
  } catch (error) {
    log.error('Garage registration failed', { email: req.body.email, error: (error as Error).message });
    next(error);
  }
};

// @desc    Login user
// @route   POST /api/auth/login
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('Login attempt', { email: req.body.email, ip: req.ip });
    const { user } = await authUsecase.authenticateUser({
      email: req.body.email,
      password: req.body.password
    });
    log.info('Login successful', { userId: user._id, role: user.role });
    await sendTokenResponse(user, 200, res);
  } catch (error) {
    log.warn('Login failed', { email: req.body.email, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
export const getMe = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('Me request', { userId: req.user?._id, role: req.user?.role });
    // req.user.garage is populated by the auth middleware for internal use,
    // but the client-side User type (web and mobile) expects garage as a
    // plain id string, matching /auth/login and /auth/register — flatten it
    // back down here rather than leaking the populated document to clients.
    // The populated garage already carries country/settings, so the locale
    // resolves here without an extra query — resolve BEFORE flattening.
    const locale = resolveGarageLocale(req.user!.garage as unknown as Parameters<typeof resolveGarageLocale>[0]);
    const data = { ...req.user!.toObject(), garage: req.user!.garage._id, locale };
    res.status(200).json({ success: true, data });
  } catch (error) {
    log.error('Failed to get current user', { error: (error as Error).message });
    next(error);
  }
};

// @desc    Update profile
// @route   PUT /api/auth/profile
export const updateProfile = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('Profile update request', { userId: req.user?._id });
    const fieldsToUpdate: { name?: string; phone?: string } = {
      name: req.body.name,
      phone: req.body.phone
    };

    // Remove undefined fields
    (Object.keys(fieldsToUpdate) as (keyof typeof fieldsToUpdate)[]).forEach(key =>
      fieldsToUpdate[key] === undefined && delete fieldsToUpdate[key]
    );

    const user = await authUsecase.updateUserProfile({
      userId: String(req.user!._id),
      updateData: fieldsToUpdate
    });

    log.info('Profile updated', { userId: req.user?._id, fields: Object.keys(fieldsToUpdate) });
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    log.error('Profile update failed', { userId: req.user?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update password
// @route   PUT /api/auth/updatepassword
export const updatePassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('Password change request', { userId: req.user?._id });
    await authUsecase.changeUserPassword({
      userId: String(req.user!._id),
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword
    });
    log.info('Password changed successfully', { userId: req.user?._id });
    res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    log.warn('Password change failed', { userId: req.user?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Request a password reset email (owners only)
// @route   POST /api/auth/forgotpassword
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('Password reset requested', { email: req.body.email });
    const { status } = await authUsecase.forgotPassword({
      email: req.body.email,
      frontendUrl: process.env.CLIENT_URL as string
    });

    const message = status === 'staff-managed'
      ? 'This account is managed by your garage. Ask your owner or an admin to reset your password from Settings → Staff.'
      : 'If an account exists for that email, a password reset link has been sent.';

    res.status(200).json({ success: true, message });
  } catch (error) {
    log.error('Password reset request failed', { email: req.body.email, error: (error as Error).message });
    next(error);
  }
};

// @desc    Reset password using emailed token
// @route   PUT /api/auth/resetpassword/:token
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await authUsecase.resetPassword({
      token: req.params.token as string,
      newPassword: req.body.password
    });
    log.info('Password reset via token succeeded');
    res.status(200).json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (error) {
    log.warn('Password reset via token failed', { error: (error as Error).message });
    next(error);
  }
};

// @desc    Log user out / clear cookie
// @route   POST /api/auth/logout
export const logout = (_req: Request, res: Response): void => {
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
