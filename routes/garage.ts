import express from 'express';
const router = express.Router();
import { getGarage, updateGarage } from '../controllers/garageController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.use(protect);

router.route('/')
  .get(asyncHandler(getGarage))
  .put(authorize('owner', 'admin'), asyncHandler(updateGarage));

export default router;
