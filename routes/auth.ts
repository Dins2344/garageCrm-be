import express from 'express';
const router = express.Router();
import { register, login, getMe, updateProfile, updatePassword, logout } from '../controllers/authController';
import { protect } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.post('/logout', asyncHandler(logout));
router.get('/me', protect, asyncHandler(getMe));
router.put('/profile', protect, asyncHandler(updateProfile));
router.put('/changepassword', protect, asyncHandler(updatePassword));
router.put('/updatepassword', protect, asyncHandler(updatePassword));

export default router;
