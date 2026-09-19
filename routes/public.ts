import express from 'express';
const router = express.Router();
import { getEstimation, approveEstimation } from '../controllers/publicController';

// No `protect` middleware — these are intentionally public endpoints.
// Security relies on the UUID token being unguessable.

router.get('/estimate/:token', getEstimation);
router.post('/estimate/:token/approve', approveEstimation);

export default router;
