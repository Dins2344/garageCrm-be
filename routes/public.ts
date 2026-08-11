import express from 'express';
const router = express.Router();
import { getEstimation, approveEstimation } from '../controllers/publicController';
import asyncHandler from '../middleware/asyncHandler';

// No `protect` middleware — these are intentionally public endpoints.
// Security relies on the UUID token being unguessable.

router.get('/estimate/:token', asyncHandler(getEstimation));
router.post('/estimate/:token/approve', asyncHandler(approveEstimation));

export default router;
