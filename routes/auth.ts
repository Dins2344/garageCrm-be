import express from 'express';
import rateLimit from 'express-rate-limit';
const router = express.Router();
import { register, login, getMe, updateProfile, updatePassword, logout, forgotPassword, resetPassword } from '../controllers/authController';
import { protect } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

// Stricter than the global /api limiter — this is an auth-recovery endpoint.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many password reset attempts. Please try again later.' },
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

export default router;
