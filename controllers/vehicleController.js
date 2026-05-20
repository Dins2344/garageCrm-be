const vehicleUsecase = require('../usecases/vehicleUsecase');
const JobCard = require('../models/JobCard');
const logger = require('../utils/logger');
const log = logger.child('VehicleController');

// @desc    Get all vehicles
// @route   GET /api/vehicles
exports.getVehicles = async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;
    const garageId = req.user.garage._id;
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
    log.error('Failed to fetch vehicles', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};

// @desc    Get single vehicle
// @route   GET /api/vehicles/:id
exports.getVehicle = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Fetching single vehicle', { vehicleId: id, garageId });
    const vehicle = await vehicleUsecase.getVehicleDetails({
      vehicleId: id,
      garageId
    });
    log.info('Vehicle fetched successfully', { vehicleId: id });
    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    log.error('Failed to fetch vehicle', { vehicleId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Create vehicle
// @route   POST /api/vehicles
exports.createVehicle = async (req, res, next) => {
  try {
    const garageId = req.user.garage._id;
    log.info('Creating new vehicle', { garageId, licensePlate: req.body.licensePlate });
    const vehicle = await vehicleUsecase.registerVehicle({
      vehicleData: req.body,
      garageId
    });
    log.info('Vehicle created successfully', { vehicleId: vehicle._id, licensePlate: vehicle.licensePlate, garageId });
    res.status(201).json({ success: true, data: vehicle });
  } catch (error) {
    log.error('Failed to create vehicle', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};

// @desc    Update vehicle
// @route   PUT /api/vehicles/:id
exports.updateVehicle = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Updating vehicle', { vehicleId: id, garageId, fields: Object.keys(req.body) });
    const vehicle = await vehicleUsecase.updateVehicleData({
      vehicleId: id,
      garageId,
      updateData: req.body
    });
    log.info('Vehicle updated successfully', { vehicleId: id, garageId });
    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    log.error('Failed to update vehicle', { vehicleId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Delete vehicle
// @route   DELETE /api/vehicles/:id
exports.deleteVehicle = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Deleting vehicle', { vehicleId: id, garageId });
    await vehicleUsecase.removeVehicle({
      vehicleId: id,
      garageId
    });
    log.info('Vehicle deleted successfully', { vehicleId: id, garageId });
    res.status(200).json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (error) {
    log.error('Failed to delete vehicle', { vehicleId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Get service history (job cards) for a vehicle
// @route   GET /api/vehicles/:id/history
exports.getVehicleHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    const { page = 1, limit = 20 } = req.query;
    log.info('Fetching vehicle service history', { vehicleId: id, garageId, page, limit });

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const query = { vehicle: id, garage: garageId };
    const total = await JobCard.countDocuments(query);

    const jobCards = await JobCard.find(query)
      .populate('customer', 'name phone')
      .populate('assignedMechanic', 'name')
      .select('-estimation.parts -estimation.labor -statusHistory -photos')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    log.info('Vehicle history fetched', { vehicleId: id, garageId, count: jobCards.length, total });
    res.status(200).json({
      success: true,
      count: jobCards.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: jobCards
    });
  } catch (error) {
    log.error('Failed to fetch vehicle history', { vehicleId: req.params.id, error: error.message });
    next(error);
  }
};
