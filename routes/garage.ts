import express from 'express';
const router = express.Router();
import { getGarage, updateGarage, listBranches, createBranch, getBranchStaff, deleteBranch, removeSampleData } from '../controllers/garageController';
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

// Mounted under the existing /api/garage on purpose: scripts/checkSwagger.ts
// matches mounts with [a-zA-Z]+, so a new hyphenated mount would be silently
// skipped and never validated. A hyphen in the path is fine.
router.delete('/sample-data', authorize('owner', 'admin'), asyncHandler(removeSampleData));

export default router;
