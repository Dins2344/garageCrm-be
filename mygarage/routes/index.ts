import express from 'express';
import { isMyGarageReady } from '../config/db';

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

export default router;
