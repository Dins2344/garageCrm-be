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

router.use(protect);

router.get('/alerts', getLowStockAlerts);

router.route('/')
  .get(getInventory)
  .post(authorize('owner', 'admin', 'service_advisor'), createInventoryItem);

router.route('/:id')
  .get(getInventoryItem)
  .put(authorize('owner', 'admin', 'service_advisor'), updateInventoryItem)
  .delete(authorize('owner', 'admin'), deleteInventoryItem);

router.put('/:id/stock', authorize('owner', 'admin', 'service_advisor'), adjustStock);

export default router;
