import { Request, Response, NextFunction } from 'express';
import * as vehicleUsecase from '../usecases/vehicleUsecase';
import logger from '../utils/logger';
const log = logger.child('VehicleController');

// @desc    Get all vehicles
// @route   GET /api/vehicles
export const getVehicles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, page, limit } = req.query as { search?: string; page?: string; limit?: string };
    const garageId = req.user!.garage._id;
    log.info('Fetching vehicles list', { garageId, search, page, limit });
    const { vehicles, total } = await vehicleUsecase.getVehiclesList({
      garageId,
      search,
      page,
      limit
    });
    log.info('Vehicles list fetched', { garageId, count: vehicles.length, total });
    res.status(200).json({
      success: true,
      count: vehicles.length,
      total,
      data: vehicles
    });
  } catch (error) {
    log.error('Failed to fetch vehicles', { garageId: req.user?.garage?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get single vehicle
// @route   GET /api/vehicles/:id
export const getVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Fetching single vehicle', { vehicleId: id, garageId });
    const vehicle = await vehicleUsecase.getVehicleDetails({
      vehicleId: id,
      garageId
    });
    log.info('Vehicle fetched successfully', { vehicleId: id });
    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    log.error('Failed to fetch vehicle', { vehicleId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Create vehicle
// @route   POST /api/vehicles
export const createVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.user!.garage._id;
    log.info('Creating new vehicle', { garageId, licensePlate: req.body.licensePlate });
    const vehicle = await vehicleUsecase.registerVehicle({
      vehicleData: req.body,
      garageId
    });
    log.info('Vehicle created successfully', { vehicleId: vehicle._id, licensePlate: vehicle.licensePlate, garageId });
    res.status(201).json({ success: true, data: vehicle });
  } catch (error) {
    log.error('Failed to create vehicle', { garageId: req.user?.garage?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update vehicle
// @route   PUT /api/vehicles/:id
export const updateVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Updating vehicle', { vehicleId: id, garageId, fields: Object.keys(req.body) });
    const vehicle = await vehicleUsecase.updateVehicleData({
      vehicleId: id,
      garageId,
      updateData: req.body
    });
    log.info('Vehicle updated successfully', { vehicleId: id, garageId });
    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    log.error('Failed to update vehicle', { vehicleId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Delete vehicle
// @route   DELETE /api/vehicles/:id
export const deleteVehicle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Deleting vehicle', { vehicleId: id, garageId });
    await vehicleUsecase.removeVehicle({
      vehicleId: id,
      garageId
    });
    log.info('Vehicle deleted successfully', { vehicleId: id, garageId });
    res.status(200).json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (error) {
    log.error('Failed to delete vehicle', { vehicleId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get service history (job cards) for a vehicle
// @route   GET /api/vehicles/:id/history
export const getVehicleHistory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    const { page = 1, limit = 20 } = req.query as { page?: string | number; limit?: string | number };
    log.info('Fetching vehicle service history', { vehicleId: id, garageId, page, limit });

    const result = await vehicleUsecase.getVehicleHistory({
      vehicleId: id,
      garageId,
      page,
      limit
    });

    log.info('Vehicle history fetched', { vehicleId: id, garageId, count: result.jobCards.length, total: result.total });
    res.status(200).json({
      success: true,
      count: result.jobCards.length,
      total: result.total,
      pages: Math.ceil(result.total / result.limit),
      currentPage: result.page,
      data: result.jobCards
    });
  } catch (error) {
    log.error('Failed to fetch vehicle history', { vehicleId: req.params.id, error: (error as Error).message });
    next(error);
  }
};
