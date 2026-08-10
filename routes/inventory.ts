import express from 'express';
const router = express.Router();
import {
  getInventory,
  getLowStockAlerts,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  adjustStock,
  deleteInventoryItem
} from '../controllers/inventoryController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

router.use(protect);

router.get('/alerts', asyncHandler(getLowStockAlerts));

router.route('/')
  .get(asyncHandler(getInventory))
  .post(authorize('owner', 'admin', 'service_advisor'), asyncHandler(createInventoryItem));

router.route('/:id')
  .get(asyncHandler(getInventoryItem))
  .put(authorize('owner', 'admin', 'service_advisor'), asyncHandler(updateInventoryItem))
  .delete(authorize('owner', 'admin'), asyncHandler(deleteInventoryItem));

router.put('/:id/stock', authorize('owner', 'admin', 'service_advisor'), asyncHandler(adjustStock));

export default router;
