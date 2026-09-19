import express from 'express';
import rateLimit from 'express-rate-limit';
const router = express.Router();
import { register, login, getMe, updateProfile, updatePassword, logout, forgotPassword, resetPassword, deleteAccount } from '../controllers/authController';
import { getStatus, sendCode, confirmCode } from '../controllers/verificationController';
import { protect, authorize } from '../middleware/auth';

// Stricter than the global /api limiter — this is an auth-recovery endpoint.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many password reset attempts. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test'
});

// Five wrong passwords per quarter hour is plenty for a real owner and not
// enough to brute-force a hijacked session into deleting the account.
const accountDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many attempts. Please try again later.' },
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

router.post('/register', register);
router.post('/login', login);
router.post('/logout', logout);
router.get('/me', protect, getMe);
router.put('/profile', protect, updateProfile);
router.put('/changepassword', protect, updatePassword);
router.put('/updatepassword', protect, updatePassword);
router.delete('/account', protect, accountDeleteLimiter, deleteAccount);
router.post('/forgotpassword', passwordResetLimiter, forgotPassword);
router.put('/resetpassword/:token', passwordResetLimiter, resetPassword);

// Owner-only for now: verification exists to gate subscription upgrades,
// which only owners make.
router.get('/verification', protect, authorize('owner'), getStatus);
router.post('/verification/:channel/send', protect, authorize('owner'), verificationLimiter, sendCode);
router.post('/verification/:channel/confirm', protect, authorize('owner'), verificationLimiter, confirmCode);

export default router;
