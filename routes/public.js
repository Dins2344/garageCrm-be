const express = require('express');
const router = express.Router();
const { getEstimation, approveEstimation } = require('../controllers/publicController');
const asyncHandler = require('../middleware/asyncHandler');

// No `protect` middleware — these are intentionally public endpoints.
// Security relies on the UUID token being unguessable.

router.get('/estimate/:token', asyncHandler(getEstimation));
router.post('/estimate/:token/approve', asyncHandler(approveEstimation));

module.exports = router;
