import express from 'express';
import { isMyGarageReady } from '../config/db';
import * as auth from '../controllers/authController';
import * as sync from '../controllers/syncController';
import * as files from '../controllers/fileController';
import * as garages from '../controllers/garageController';
import * as invites from '../controllers/inviteController';
import { refuseIfSharing } from '../middleware/legacy';
import { requireUser } from '../middleware/auth';
import { authLimiter, authSessionLimiter, inviteLimiter, userLimiter } from '../middleware/rateLimit';
import { mgErrorHandler } from '../middleware/errorHandler';

const router = express.Router();

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

router.use((_req, res, next) => {
  if (!isMyGarageReady()) {
    res.status(503).json({ success: false, message: 'Sync is unavailable right now. Try again later.' });
    return;
  }
  next();
});

router.post('/auth/google', authLimiter, auth.google);
router.post('/auth/refresh', authSessionLimiter, auth.refresh);
router.post('/auth/sign-out', authSessionLimiter, auth.signOut);
router.get('/invite/:token', invites.linkPage);

// Everything below needs a signed-in user.
router.use(requireUser, userLimiter);
router.get('/me', auth.me);
router.get('/key', auth.key);
router.delete('/account', auth.deleteAccount);
router.post('/sync/push', refuseIfSharing, sync.push);
router.get('/sync/pull', refuseIfSharing, sync.pull);
router.post('/files/:fileId/upload-url', refuseIfSharing, files.uploadUrl);
router.post('/files/:fileId/complete', refuseIfSharing, files.complete);
router.get('/files/:fileId/download-url', refuseIfSharing, files.downloadUrl);
router.post('/v2/sync/push', sync.pushV2);
router.post('/v2/sync/pull', sync.pullV2);
router.post('/v2/files/:scope/:fileId/upload-url', files.uploadUrlV2);
router.post('/v2/files/:scope/:fileId/complete', files.completeV2);
router.get('/v2/files/:scope/:fileId/download-url', files.downloadUrlV2);
router.get('/v2/garages', garages.list);
router.post('/v2/garages/:garageId/share', garages.share);
router.get('/v2/garages/:garageId/key', garages.key);
router.get('/v2/garages/:garageId/people', garages.people);
router.patch('/v2/garages/:garageId/members/:memberId', garages.setRole);
router.delete('/v2/garages/:garageId/members/:memberId', garages.removeMember);
router.post('/v2/garages/:garageId/release', garages.release);
router.delete('/v2/garages/:garageId', garages.remove);
router.post('/v2/garages/:garageId/invites', inviteLimiter, invites.create);
router.get('/v2/invites', invites.mine);
router.post('/v2/invites/accept-link', invites.acceptLink);
router.post('/v2/invites/:inviteId/resend', inviteLimiter, invites.resend);
router.post('/v2/invites/:inviteId/accept', invites.accept);
router.post('/v2/invites/:inviteId/decline', invites.decline);
router.delete('/v2/invites/:inviteId', invites.cancel);

router.use(mgErrorHandler);

export default router;
