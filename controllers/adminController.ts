import { Request, Response, NextFunction } from 'express';
import * as adminUsecase from '../usecases/adminUsecase';
import logger from '../utils/logger';
const log = logger.child('AdminController');

// @desc    Admin login — returns a short-lived JWT
// @route   POST /api/admin/login
export const login = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const { email, password } = req.body;
    log.info('Admin login request received', { email });
    const { token, admin } = adminUsecase.adminLogin({ email, password });
    res.json({ success: true, token, data: admin });
  } catch (error) {
    log.error('Admin login error', { error: (error as Error).message });
    next(error);
  }
};

// @desc    Verify admin token
// @route   GET /api/admin/verify
export const verify = (req: Request, res: Response): void => {
  // If we reach here, adminAuth middleware already validated the token
  log.info('Admin token verified', { email: req.admin?.email });
  res.json({ success: true, data: req.admin });
};

// @desc    Get platform-wide stats
// @route   GET /api/admin/stats
export const getStats = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('Admin stats request', { adminEmail: req.admin?.email });
    const stats = await adminUsecase.getSystemStats();
    log.info('Admin stats served', { queryTimeMs: stats.queryTimeMs });
    res.json({ success: true, data: stats });
  } catch (error) {
    log.error('Failed to compile admin stats', { error: (error as Error).message });
    next(error);
  }
};

// @desc    Get all garages with enriched counts & revenue
// @route   GET /api/admin/garages
export const getGarages = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('Admin all-garages request', { adminEmail: req.admin?.email });
    const garages = await adminUsecase.getAllGarages();
    log.info('All garages served', { count: garages.length });
    res.json({ success: true, data: garages });
  } catch (error) {
    log.error('Failed to fetch all garages', { error: (error as Error).message });
    next(error);
  }
};

// @desc    Delete a garage that has no owner (cleanup for orphaned garages)
// @route   DELETE /api/admin/garages/:id
export const deleteGarage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.params.id as string;
    log.warn('Admin delete-orphaned-garage request', { adminEmail: req.admin?.email, garageId });
    const result = await adminUsecase.deleteOrphanedGarage(garageId);
    log.warn('Admin delete-orphaned-garage completed', { adminEmail: req.admin?.email, garageId, result });
    res.json({ success: true, data: result });
  } catch (error) {
    log.error('Admin delete-orphaned-garage failed', { adminEmail: req.admin?.email, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get all users across all garages
// @route   GET /api/admin/users
export const getUsers = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    log.info('Admin all-users request', { adminEmail: req.admin?.email });
    const users = await adminUsecase.getAllUsers();
    log.info('All platform users served', { count: users.length });
    res.json({ success: true, data: users });
  } catch (error) {
    log.error('Failed to fetch all users', { error: (error as Error).message });
    next(error);
  }
};

// @desc    Delete a platform user — cascades to their entire garage if they're an owner
// @route   DELETE /api/admin/users/:id
export const deleteUser = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.params.id as string;
    log.warn('Admin delete-user request', { adminEmail: req.admin?.email, userId });
    const result = await adminUsecase.deleteUser(userId);
    log.warn('Admin delete-user completed', { adminEmail: req.admin?.email, userId, result });
    res.json({ success: true, data: result });
  } catch (error) {
    log.error('Admin delete-user failed', { adminEmail: req.admin?.email, error: (error as Error).message });
    next(error);
  }
};

// @desc    System health info
// @route   GET /api/admin/health
export const getHealth = (req: Request, res: Response, next: NextFunction): void => {
  try {
    log.info('Admin health check', { adminEmail: req.admin?.email });
    const health = adminUsecase.getHealthInfo();
    res.json({ success: true, data: health });
  } catch (error) {
    log.error('Failed to get health info', { error: (error as Error).message });
    next(error);
  }
};
