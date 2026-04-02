const Vehicle = require('../models/Vehicle');
const Customer = require('../models/Customer');
const logger = require('../utils/logger');
const log = logger.child('VehicleUsecase');

exports.getVehiclesList = async ({ garageId, search, page = 1, limit = 20 }) => {
  let query = { garage: garageId };

  if (search) {
    query.licensePlate = { $regex: search, $options: 'i' };
  }

  const total = await Vehicle.countDocuments(query);
  const vehicles = await Vehicle.find(query)
    .populate('customer', 'name phone')
    .sort('-createdAt')
    .skip((page - 1) * limit)
    .limit(parseInt(limit))
    .lean();

  return { vehicles, total };
};

exports.getVehicleDetails = async ({ vehicleId, garageId }) => {
  const vehicle = await Vehicle.findOne({ _id: vehicleId, garage: garageId })
    .populate('customer')
    .populate({
      path: 'serviceHistory',
      options: { sort: { createdAt: -1 }, limit: 10 }
    })
    .lean();

  if (!vehicle) {
    const error = new Error('Vehicle not found');
    error.statusCode = 404;
    throw error;
  }

  return vehicle;
};

exports.registerVehicle = async ({ vehicleData, garageId }) => {
  vehicleData.garage = garageId;
  const vehicle = await Vehicle.create(vehicleData);

  // side effect: update customer's vehicles list
  await Customer.findByIdAndUpdate(vehicle.customer, {
    $push: { vehicles: vehicle._id }
  });

  log.info('New vehicle registered', { vehicleId: vehicle._id, customerId: vehicle.customer });
  return vehicle;
};

exports.updateVehicleData = async ({ vehicleId, garageId, updateData }) => {
  const vehicle = await Vehicle.findOneAndUpdate(
    { _id: vehicleId, garage: garageId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!vehicle) {
    const error = new Error('Vehicle not found');
    error.statusCode = 404;
    throw error;
  }

  return vehicle;
};

exports.removeVehicle = async ({ vehicleId, garageId }) => {
  const vehicle = await Vehicle.findOneAndDelete({ _id: vehicleId, garage: garageId });

  if (!vehicle) {
    const error = new Error('Vehicle not found');
    error.statusCode = 404;
    throw error;
  }

  // side effect: remove from customer's vehicles list
  await Customer.findByIdAndUpdate(vehicle.customer, { $pull: { vehicles: vehicle._id } });

  log.info('Vehicle removed from registry', { vehicleId, garageId });
  return true;
};
