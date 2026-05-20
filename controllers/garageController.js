const garageUsecase = require('../usecases/garageUsecase');
const logger = require('../utils/logger');
const log = logger.child('GarageController');

// @desc    Get garage info for current user's garage
// @route   GET /api/garage
exports.getGarage = async (req, res, next) => {
  try {
    const garageId = req.user.garage._id;
    log.info('Fetching garage info', { garageId });
    const garage = await garageUsecase.getGarageById({ garageId });
    log.info('Garage info fetched', { garageId, name: garage.name });
    res.status(200).json({ success: true, data: garage });
  } catch (error) {
    log.error('Failed to fetch garage', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};

// @desc    Update garage info (owner / admin only)
// @route   PUT /api/garage
exports.updateGarage = async (req, res, next) => {
  try {
    const garageId = req.user.garage._id;
    log.info('Updating garage info', { garageId, fields: Object.keys(req.body) });
    const garage = await garageUsecase.updateGarageInfo({ garageId, updateData: req.body });
    log.info('Garage info updated', { garageId });
    res.status(200).json({ success: true, data: garage });
  } catch (error) {
    log.error('Failed to update garage', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};
