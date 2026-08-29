import express, { Request, Response, NextFunction } from 'express';
const router = express.Router();
import asyncHandler from '../middleware/asyncHandler';
import * as adminController from '../controllers/adminController';
import * as adminUsecase from '../usecases/adminUsecase';
import logger from '../utils/logger';
const log = logger.child('AdminRoute');

// ─── Admin auth middleware ─────────────────────────────────────────────────
// Validates the super-admin JWT on every protected route.
// Token verification logic lives in adminUsecase — the middleware just orchestrates.
async function adminAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    log.warn('Admin request rejected — no token provided', { ip: req.ip, url: req.originalUrl });
    res.status(401).json({ success: false, message: 'No admin token' });
    return;
  }
  try {
    // Async because the admin record is re-read on every request, so a
    // deactivated account loses access immediately rather than when its token
    // expires. See adminUsecase.verifyAdminToken.
    req.admin = await adminUsecase.verifyAdminToken(token);
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
router.delete('/garages/:id', adminController.deleteGarage);
router.get('/users',   adminController.getUsers);
router.delete('/users/:id', adminController.deleteUser);
router.get('/health',  adminController.getHealth);

// The first write endpoints on this surface — everything above is read or
// delete. The `router.use(adminAuth)` above already covers every verb;
// tests/appRelease.test.ts proves it for PUT specifically.
router.get('/app-release', asyncHandler(adminController.getAppRelease));
router.put('/app-release', asyncHandler(adminController.updateAppRelease));

export default router;
