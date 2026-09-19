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

router.use(protect);

router.route('/')
  .get(getVehicles)
  .post(authorize('owner', 'admin', 'service_advisor', 'receptionist'), createVehicle);

router.route('/:id')
  .get(getVehicle)
  .put(authorize('owner', 'admin', 'service_advisor'), updateVehicle)
  .delete(authorize('owner', 'admin'), deleteVehicle);

router.get('/:id/history', getVehicleHistory);

export default router;
