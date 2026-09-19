import express from 'express';
const router = express.Router();
import { getGarage, updateGarage, listBranches, createBranch, getBranchStaff, deleteBranch } from '../controllers/garageController';
import { protect, authorize } from '../middleware/auth';

router.use(protect);

router.route('/')
  .get(getGarage)
  .put(authorize('owner', 'admin'), updateGarage);

router.route('/branches')
  .get(authorize('owner'), listBranches)
  .post(authorize('owner'), createBranch);

router.get('/branches/:id/staff', authorize('owner'), getBranchStaff);
router.delete('/branches/:id', authorize('owner'), deleteBranch);

// Mounted under the existing /api/garage on purpose: scripts/checkSwagger.ts
// matches mounts with [a-zA-Z]+, so a new hyphenated mount would be silently
// skipped and never validated. A hyphen in the path is fine.

export default router;
