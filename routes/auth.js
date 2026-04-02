const express = require('express');
const router = express.Router();
const { register, login, getMe, updateProfile } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

router.post('/register', asyncHandler(register));
router.post('/login', asyncHandler(login));
router.get('/me', protect, asyncHandler(getMe));
router.put('/profile', protect, asyncHandler(updateProfile));

module.exports = router;
