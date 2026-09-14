import express from 'express';
import rateLimit from 'express-rate-limit';
const router = express.Router();
import { register, login, getMe, updateProfile, updatePassword, logout, forgotPassword, resetPassword } from '../controllers/authController';
import { getStatus, sendCode, confirmCode } from '../controllers/verificationController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

// Stricter than the global /api limiter — this is an auth-recovery endpoint.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many password reset attempts. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test'
});

// Per-IP backstop for the code endpoints; the usecase carries the per-user
// cooldown, hourly cap and attempt limit that actually govern them.
const verificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many verification attempts. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test'
});

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.get('/me', protect, asyncHandler(getMe));
router.put('/profile', protect, asyncHandler(updateProfile));
router.put('/changepassword', protect, asyncHandler(updatePassword));
router.put('/updatepassword', protect, asyncHandler(updatePassword));
router.post('/forgotpassword', passwordResetLimiter, asyncHandler(forgotPassword));
router.put('/resetpassword/:token', passwordResetLimiter, asyncHandler(resetPassword));

// Owner-only for now: verification exists to gate subscription upgrades,
// which only owners make.
router.get('/verification', protect, authorize('owner'), asyncHandler(getStatus));
router.post('/verification/:channel/send', protect, authorize('owner'), verificationLimiter, asyncHandler(sendCode));
router.post('/verification/:channel/confirm', protect, authorize('owner'), verificationLimiter, asyncHandler(confirmCode));

export default router;
