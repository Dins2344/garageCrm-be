const vehicleUsecase = require('../usecases/vehicleUsecase');
const logger = require('../utils/logger');
const log = logger.child('VehicleController');

// @desc    Get all vehicles
// @route   GET /api/vehicles
exports.getVehicles = async (req, res, next) => {
  try {
    const { search, page, limit } = req.query;
    const { vehicles, total } = await vehicleUsecase.getVehiclesList({
      garageId: req.user.garage._id,
      search,
      page,
      limit
    });

    res.status(200).json({
      success: true,
      count: vehicles.length,
      total,
      data: vehicles
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single vehicle
// @route   GET /api/vehicles/:id
exports.getVehicle = async (req, res, next) => {
  try {
    const vehicle = await vehicleUsecase.getVehicleDetails({
      vehicleId: req.params.id,
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    next(error);
  }
};

// @desc    Create vehicle
// @route   POST /api/vehicles
exports.createVehicle = async (req, res, next) => {
  try {
    const vehicle = await vehicleUsecase.registerVehicle({
      vehicleData: req.body,
      garageId: req.user.garage._id
    });
    res.status(201).json({ success: true, data: vehicle });
  } catch (error) {
    next(error);
  }
};

// @desc    Update vehicle
// @route   PUT /api/vehicles/:id
exports.updateVehicle = async (req, res, next) => {
  try {
    const vehicle = await vehicleUsecase.updateVehicleData({
      vehicleId: req.params.id,
      garageId: req.user.garage._id,
      updateData: req.body
    });
    res.status(200).json({ success: true, data: vehicle });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete vehicle
// @route   DELETE /api/vehicles/:id
exports.deleteVehicle = async (req, res, next) => {
  try {
    await vehicleUsecase.removeVehicle({
      vehicleId: req.params.id,
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, message: 'Vehicle deleted successfully' });
  } catch (error) {
    next(error);
  }
};
