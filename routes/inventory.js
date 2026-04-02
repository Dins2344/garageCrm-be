const express = require('express');
const router = express.Router();
const {
  getInventory,
  getLowStockAlerts,
  getInventoryItem,
  createInventoryItem,
  updateInventoryItem,
  adjustStock,
  deleteInventoryItem
} = require('../controllers/inventoryController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

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

module.exports = router;
