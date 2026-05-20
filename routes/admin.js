const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const adminUsecase = require('../usecases/adminUsecase');
const logger = require('../utils/logger');
const log = logger.child('AdminRoute');

// ─── Admin auth middleware ─────────────────────────────────────────────────
// Validates the super-admin JWT on every protected route.
// Token verification logic lives in adminUsecase — the middleware just orchestrates.
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    log.warn('Admin request rejected — no token provided', { ip: req.ip, url: req.originalUrl });
    return res.status(401).json({ success: false, message: 'No admin token' });
  }
  try {
    req.admin = adminUsecase.verifyAdminToken(token);
    next();
  } catch (error) {
    return res.status(error.statusCode || 401).json({ success: false, message: error.message });
  }
}

// ─── Public (no auth) ──────────────────────────────────────────────────────
router.post('/login',  adminController.login);

// ─── Protected (super-admin JWT required) ──────────────────────────────────
router.use(adminAuth);

router.get('/verify',  adminController.verify);
router.get('/stats',   adminController.getStats);
router.get('/garages', adminController.getGarages);
router.get('/users',   adminController.getUsers);
router.get('/health',  adminController.getHealth);

module.exports = router;
