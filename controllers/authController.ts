import { Request, Response, NextFunction } from 'express';
import * as authUsecase from '../usecases/authUsecase';
import { IUser } from '../models/User';
import logger from '../utils/logger';
const log = logger.child('AuthController');

// Helper to send formatted token response
const sendTokenResponse = (user: IUser, statusCode: number, res: Response): void => {
  const token = user.getSignedJwtToken();

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
        garage: user.garage
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
    sendTokenResponse(user, 201, res);
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
    sendTokenResponse(user, 200, res);
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
    // req.user is already populated by auth middleware
    res.status(200).json({ success: true, data: req.user });
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
