import express from 'express';
import { isMyGarageReady } from '../config/db';
import * as auth from '../controllers/authController';
import * as sync from '../controllers/syncController';
import * as files from '../controllers/fileController';
import { requireUser } from '../middleware/auth';
import { authLimiter, userLimiter } from '../middleware/rateLimit';

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

router.use('/auth', authLimiter);
router.post('/auth/google', auth.google);
router.post('/auth/refresh', auth.refresh);
router.post('/auth/sign-out', auth.signOut);

// Everything below needs a signed-in user.
router.use(requireUser, userLimiter);
router.get('/me', auth.me);
router.get('/key', auth.key);
router.post('/sync/push', sync.push);
router.get('/sync/pull', sync.pull);
router.post('/files/:fileId/upload-url', files.uploadUrl);
router.post('/files/:fileId/complete', files.complete);
router.get('/files/:fileId/download-url', files.downloadUrl);

export default router;
