import express from 'express';
const router = express.Router();
import { getGarage, updateGarage, listBranches, createBranch, getBranchStaff, deleteBranch } from '../controllers/garageController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.use(protect);

router.route('/')
  .get(asyncHandler(getGarage))
  .put(authorize('owner', 'admin'), asyncHandler(updateGarage));

router.route('/branches')
  .get(authorize('owner'), asyncHandler(listBranches))
  .post(authorize('owner'), asyncHandler(createBranch));

router.get('/branches/:id/staff', authorize('owner'), asyncHandler(getBranchStaff));
router.delete('/branches/:id', authorize('owner'), asyncHandler(deleteBranch));

export default router;
