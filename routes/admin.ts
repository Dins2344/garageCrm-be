import express, { Request, Response, NextFunction } from 'express';
const router = express.Router();
import * as adminController from '../controllers/adminController';
import * as adminUsecase from '../usecases/adminUsecase';
import logger from '../utils/logger';
const log = logger.child('AdminRoute');

// ─── Admin auth middleware ─────────────────────────────────────────────────
// Validates the super-admin JWT on every protected route.
// Token verification logic lives in adminUsecase — the middleware just orchestrates.
function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    log.warn('Admin request rejected — no token provided', { ip: req.ip, url: req.originalUrl });
    res.status(401).json({ success: false, message: 'No admin token' });
    return;
  }
  try {
    req.admin = adminUsecase.verifyAdminToken(token);
    next();
  } catch (error) {
    const err = error as Error & { statusCode?: number };
    res.status(err.statusCode || 401).json({ success: false, message: err.message });
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

export default router;
