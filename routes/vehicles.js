const express = require('express');
const router = express.Router();
const {
  getVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getVehicleHistory
} = require('../controllers/vehicleController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

router.use(protect);

router.route('/')
  .get(asyncHandler(getVehicles))
  .post(authorize('owner', 'admin', 'service_advisor', 'receptionist'), asyncHandler(createVehicle));

router.route('/:id')
  .get(asyncHandler(getVehicle))
  .put(authorize('owner', 'admin', 'service_advisor'), asyncHandler(updateVehicle))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteVehicle));

router.get('/:id/history', asyncHandler(getVehicleHistory));

module.exports = router;
