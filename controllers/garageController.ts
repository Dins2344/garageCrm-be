import { Request, Response } from 'express';
import * as garageUsecase from '../usecases/garageUsecase';
import { resolveGarageLocale, LocaleSource } from '../utils/locale';
import logger from '../utils/logger';
const log = logger.child('GarageController');

/**
 * Attach the resolved locale to a garage payload so clients never need to
 * carry a copy of the country table — they just render what's handed to them.
 */
const withLocale = (garage: Record<string, unknown>) => ({
  ...garage,
  locale: resolveGarageLocale(garage as LocaleSource)
});

// @desc    Get garage info for current user's active garage
// @route   GET /api/garage
export const getGarage = async (req: Request, res: Response): Promise<void> => {
  const garageId = req.garageId!;
  log.info('Fetching garage info', { garageId });
  const garage = await garageUsecase.getGarageById({ garageId });
  log.info('Garage info fetched', { garageId, name: garage.name });
  res.status(200).json({ success: true, data: withLocale(garage) });
};

// @desc    Update garage info (owner / admin only)
// @route   PUT /api/garage
export const updateGarage = async (req: Request, res: Response): Promise<void> => {
  const garageId = req.garageId!;
  log.info('Updating garage info', { garageId, fields: Object.keys(req.body) });
  const garage = await garageUsecase.updateGarageInfo({ garageId, updateData: req.body });
  log.info('Garage info updated', { garageId });
  res.status(200).json({ success: true, data: withLocale(garage) });
};

// @desc    List every garage owned by the current owner
// @route   GET /api/garage/branches
export const listBranches = async (req: Request, res: Response): Promise<void> => {
  const ownerId = req.user!._id;
  log.info('Listing owner garages', { ownerId });
  const garages = await garageUsecase.listOwnerGarages({ ownerId });
  res.status(200).json({ success: true, count: garages.length, data: garages.map(withLocale) });
};

// @desc    Create an additional garage (branch) for the current owner
// @route   POST /api/garage/branches
export const createBranch = async (req: Request, res: Response): Promise<void> => {
  const ownerId = req.user!._id;
  log.info('Creating additional garage', { ownerId, name: req.body.name });
  const garage = await garageUsecase.createAdditionalGarage({ ownerId, garageData: req.body });
  log.info('Additional garage created', { garageId: garage._id, ownerId });
  res.status(201).json({ success: true, data: withLocale(garage) });
};

// @desc    List staff assigned to a specific branch — checked before deletion
//          so the client knows whether to ask the owner what to do with them
// @route   GET /api/garage/branches/:id/staff
export const getBranchStaff = async (req: Request, res: Response): Promise<void> => {
  const ownerId = req.user!._id;
  const garageId = req.params.id as string;
  const staff = await garageUsecase.getBranchStaff({ ownerId, garageId });
  res.status(200).json({ success: true, data: staff });
};

// @desc    Delete a branch (owner must have more than one; staffAction required
//          if the branch has staff assigned)
// @route   DELETE /api/garage/branches/:id
export const deleteBranch = async (req: Request, res: Response): Promise<void> => {
  const ownerId = req.user!._id;
  const garageId = req.params.id as string;
  log.warn('Owner delete-branch request', { ownerId, garageId, staffAction: req.body?.staffAction });
  const result = await garageUsecase.deleteBranch({
    ownerId,
    garageId,
    staffAction: req.body?.staffAction,
    reassignToGarageId: req.body?.reassignToGarageId
  });
  log.warn('Owner delete-branch completed', { ownerId, garageId, result });
  res.status(200).json({ success: true, data: result });
};
