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
import asyncHandler from '../middleware/asyncHandler';

router.use(protect);

router.route('/')
  .get(authorize('owner', 'admin', 'service_advisor', 'receptionist'), asyncHandler(getUsers))
  .post(authorize('owner', 'admin'), asyncHandler(createUser));

router.route('/:id')
  .get(authorize('owner', 'admin'), asyncHandler(getUser))
  .put(authorize('owner', 'admin'), asyncHandler(updateUser))
  .delete(authorize('owner'), asyncHandler(deleteUser));

router.patch('/:id/:action', authorize('owner', 'admin'), asyncHandler(toggleUserStatus));

export default router;
