const Garage = require('../models/Garage');
const logger = require('../utils/logger');
const log = logger.child('GarageUsecase');

/**
 * Get garage by ID
 */
exports.getGarageById = async ({ garageId }) => {
  const garage = await Garage.findById(garageId);
  if (!garage) {
    const error = new Error('Garage not found');
    error.statusCode = 404;
    throw error;
  }
  return garage;
};

/**
 * Update garage info — only allows safe, pre-defined fields
 */
exports.updateGarageInfo = async ({ garageId, updateData }) => {
  const ALLOWED = ['name', 'phone', 'email', 'gstNumber', 'address', 'settings'];
  const sanitized = {};
  ALLOWED.forEach(field => {
    if (updateData[field] !== undefined) {
      sanitized[field] = updateData[field];
    }
  });

  const garage = await Garage.findByIdAndUpdate(
    garageId,
    { $set: sanitized },
    { new: true, runValidators: true }
  );

  if (!garage) {
    const error = new Error('Garage not found');
    error.statusCode = 404;
    throw error;
  }

  log.info('Garage info updated', { garageId, fields: Object.keys(sanitized) });
  return garage;
};
