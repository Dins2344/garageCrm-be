const garageUsecase = require('../usecases/garageUsecase');
const logger = require('../utils/logger');
const log = logger.child('GarageController');

// @desc    Get garage info for current user's garage
// @route   GET /api/garage
exports.getGarage = async (req, res, next) => {
  try {
    const garage = await garageUsecase.getGarageById({
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, data: garage });
  } catch (error) {
    next(error);
  }
};

// @desc    Update garage info (owner / admin only)
// @route   PUT /api/garage
exports.updateGarage = async (req, res, next) => {
  try {
    const garage = await garageUsecase.updateGarageInfo({
      garageId: req.user.garage._id,
      updateData: req.body
    });
    res.status(200).json({ success: true, data: garage });
  } catch (error) {
    next(error);
  }
};
