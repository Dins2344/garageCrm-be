import express from 'express';
const router = express.Router();
import {
  getNotifications, getUnreadCount, readNotification, readAllNotifications, savePushToken, deletePushToken
} from '../controllers/notificationController';
import { protect } from '../middleware/auth';

// Every role has notifications; each query is scoped to the caller, not the garage.
router.use(protect);

router.get('/', getNotifications);
router.get('/unread-count', getUnreadCount);
router.put('/read-all', readAllNotifications);
router.put('/:id/read', readNotification);
router.route('/push-token')
  .post(savePushToken)
  .delete(deletePushToken);

export default router;
