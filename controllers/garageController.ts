import { Request, Response, NextFunction } from 'express';
import * as garageUsecase from '../usecases/garageUsecase';
import logger from '../utils/logger';
const log = logger.child('GarageController');

// @desc    Get garage info for current user's active garage
// @route   GET /api/garage
export const getGarage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.garageId!;
    log.info('Fetching garage info', { garageId });
    const garage = await garageUsecase.getGarageById({ garageId });
    log.info('Garage info fetched', { garageId, name: garage.name });
    res.status(200).json({ success: true, data: garage });
  } catch (error) {
    log.error('Failed to fetch garage', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update garage info (owner / admin only)
// @route   PUT /api/garage
export const updateGarage = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.garageId!;
    log.info('Updating garage info', { garageId, fields: Object.keys(req.body) });
    const garage = await garageUsecase.updateGarageInfo({ garageId, updateData: req.body });
    log.info('Garage info updated', { garageId });
    res.status(200).json({ success: true, data: garage });
  } catch (error) {
    log.error('Failed to update garage', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    List every garage owned by the current owner
// @route   GET /api/garage/branches
export const listBranches = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ownerId = req.user!._id;
    log.info('Listing owner garages', { ownerId });
    const garages = await garageUsecase.listOwnerGarages({ ownerId });
    res.status(200).json({ success: true, count: garages.length, data: garages });
  } catch (error) {
    log.error('Failed to list owner garages', { ownerId: req.user?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Create an additional garage (branch) for the current owner
// @route   POST /api/garage/branches
export const createBranch = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ownerId = req.user!._id;
    log.info('Creating additional garage', { ownerId, name: req.body.name });
    const garage = await garageUsecase.createAdditionalGarage({ ownerId, garageData: req.body });
    log.info('Additional garage created', { garageId: garage._id, ownerId });
    res.status(201).json({ success: true, data: garage });
  } catch (error) {
    log.error('Failed to create additional garage', { ownerId: req.user?._id, error: (error as Error).message });
    next(error);
  }
};
