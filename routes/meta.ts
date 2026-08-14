import express from 'express';
import { getCountryOptions } from '../config/countries';

const router = express.Router();

/**
 * Supported countries for the signup / settings pickers.
 *
 * Public and unauthenticated on purpose: the registration form needs it
 * before a user exists. Static reference data with nothing tenant-specific.
 */
router.get('/countries', (_req, res) => {
  res.status(200).json({ success: true, data: getCountryOptions() });
});

export default router;
