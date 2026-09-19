import { Request, Response } from 'express';
import * as userUsecase from '../usecases/userUsecase';
import logger from '../utils/logger';
const log = logger.child('UserController');

// @desc    Get all staff/users
// @route   GET /api/users
export const getUsers = async (req: Request, res: Response): Promise<void> => {
  const garageId = req.garageId!;
  log.info('Fetching staff list', { garageId });
  const users = await userUsecase.getStaffList({ garageId });
  log.info('Staff list fetched', { garageId, count: users.length });
  res.status(200).json({ success: true, count: users.length, data: users });
};

// @desc    Get single staff member
// @route   GET /api/users/:id
export const getUser = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const garageId = req.garageId!;
  log.info('Fetching staff member', { staffId: id, garageId });
  const user = await userUsecase.getStaffMember({ staffId: id, garageId });
  log.info('Staff member fetched', { staffId: id });
  res.status(200).json({ success: true, data: user });
};

// @desc    Create staff member
// @route   POST /api/users
export const createUser = async (req: Request, res: Response): Promise<void> => {
  const garageId = req.garageId!;
  log.info('Creating staff member', { garageId, role: req.body.role, email: req.body.email });
  // Only owner and admin can create users
  const user = await userUsecase.registerStaff({ staffData: req.body, garageId });
  log.info('Staff member created', { userId: user._id, role: user.role, garageId });
  res.status(201).json({ success: true, data: user });
};

// @desc    Update user
// @route   PUT /api/users/:id
export const updateUser = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const garageId = req.garageId!;
  log.info('Updating staff member', { staffId: id, garageId, fields: Object.keys(req.body) });
  const user = await userUsecase.updateStaffDetails({ staffId: id, garageId, updateData: req.body });
  log.info('Staff member updated', { staffId: id });
  res.status(200).json({ success: true, data: user });
};

// @desc    Activate/Deactivate user
// @route   PATCH /api/users/:id/:action
export const toggleUserStatus = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const action = req.params.action as string;
  const garageId = req.garageId!;
  log.info('Toggling staff status', { staffId: id, garageId, action });
  const user = await userUsecase.deactivateStaff({ staffId: id, garageId, action });
  log.info('Staff status toggled', { staffId: id, isActive: user.isActive });
  res.status(200).json({ success: true, data: user });
};

// @desc    Delete user
// @route   DELETE /api/users/:id
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  const id = req.params.id as string;
  const garageId = req.garageId!;
  log.info('Deleting staff member', { staffId: id, garageId });
  await userUsecase.removeStaff({ staffId: id, garageId });
  log.info('Staff member deleted', { staffId: id, garageId });
  res.status(200).json({ success: true, message: 'User deleted successfully' });
};
