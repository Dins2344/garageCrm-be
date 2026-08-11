import express from 'express';
const router = express.Router();
import {
  getVehicles,
  getVehicle,
  createVehicle,
  updateVehicle,
  deleteVehicle,
  getVehicleHistory
} from '../controllers/vehicleController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.use(protect);

router.route('/')
  .get(asyncHandler(getVehicles))
  .post(authorize('owner', 'admin', 'service_advisor', 'receptionist'), asyncHandler(createVehicle));

router.route('/:id')
  .get(asyncHandler(getVehicle))
  .put(authorize('owner', 'admin', 'service_advisor'), asyncHandler(updateVehicle))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteVehicle));

router.get('/:id/history', asyncHandler(getVehicleHistory));

export default router;
