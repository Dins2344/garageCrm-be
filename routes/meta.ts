import express from 'express';
import asyncHandler from '../middleware/asyncHandler';
import * as metaController from '../controllers/metaController';
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

/**
 * Whether the calling app build should update, and whether it must.
 *
 * Public and unauthenticated like /countries: this runs on a cold start before
 * anyone has logged in. Mounted under the existing /api/meta on purpose — a new
 * hyphenated mount such as /api/app-config is silently skipped by
 * scripts/checkSwagger.ts's `[a-zA-Z]+` mount regex and would never be checked
 * for documentation at all.
 */
router.get('/app-update', asyncHandler(metaController.getAppUpdate));

export default router;
