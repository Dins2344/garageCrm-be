import express from 'express';
const router = express.Router();
import {
  getUsers,
  getUser,
  createUser,
  updateUser,
  toggleUserStatus,
  deleteUser
} from '../controllers/userController';
import { protect, authorize } from '../middleware/auth';

router.use(protect);

router.route('/')
  .get(authorize('owner', 'admin', 'service_advisor', 'receptionist'), getUsers)
  .post(authorize('owner', 'admin'), createUser);

router.route('/:id')
  .get(authorize('owner', 'admin'), getUser)
  .put(authorize('owner', 'admin'), updateUser)
  .delete(authorize('owner'), deleteUser);

router.patch('/:id/:action', authorize('owner', 'admin'), toggleUserStatus);

export default router;
