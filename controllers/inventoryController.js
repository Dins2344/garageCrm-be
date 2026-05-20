const inventoryUsecase = require('../usecases/inventoryUsecase');
const logger = require('../utils/logger');
const log = logger.child('InventoryController');

// @desc    Get all inventory
// @route   GET /api/inventory
exports.getInventory = async (req, res, next) => {
  try {
    const { search, category, page, limit } = req.query;
    const garageId = req.user.garage._id;
    log.info('Fetching inventory list', { garageId, search, category, page, limit });
    const { items, total } = await inventoryUsecase.getInventoryList({ garageId, search, category, page, limit });
    log.info('Inventory list fetched', { garageId, count: items.length, total });
    res.status(200).json({ success: true, count: items.length, total, data: items });
  } catch (error) {
    log.error('Failed to fetch inventory', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};

// @desc    Get single inventory item
// @route   GET /api/inventory/:id
exports.getInventoryItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Fetching inventory item', { itemId: id, garageId });
    const item = await inventoryUsecase.getItemDetails({ itemId: id, garageId });
    log.info('Inventory item fetched', { itemId: id });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to fetch inventory item', { itemId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Add item to inventory
// @route   POST /api/inventory
exports.createInventoryItem = async (req, res, next) => {
  try {
    const garageId = req.user.garage._id;
    log.info('Creating inventory item', { garageId, partName: req.body.partName });
    const item = await inventoryUsecase.registerItem({ itemData: req.body, garageId });
    log.info('Inventory item created', { itemId: item._id, partName: item.partName, garageId });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to create inventory item', { garageId: req.user?.garage?._id, error: error.message });
    next(error);
  }
};

// @desc    Update inventory item
// @route   PUT /api/inventory/:id
exports.updateInventoryItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Updating inventory item', { itemId: id, garageId, fields: Object.keys(req.body) });
    const item = await inventoryUsecase.updateItemData({ itemId: id, garageId, updateData: req.body });
    log.info('Inventory item updated', { itemId: id });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to update inventory item', { itemId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Adjust stock manually
// @route   PATCH /api/inventory/:id/stock
exports.adjustStock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Adjusting stock', { itemId: id, garageId, adjustment: req.body.adjustment, userId: req.user._id });
    const item = await inventoryUsecase.adjustItemStock({
      itemId: id,
      garageId,
      adjustment: req.body.adjustment,
      userId: req.user._id
    });
    log.info('Stock adjusted', { itemId: id, newQuantity: item.quantity });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to adjust stock', { itemId: req.params.id, error: error.message });
    next(error);
  }
};

// @desc    Delete inventory item
// @route   DELETE /api/inventory/:id
exports.deleteInventoryItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const garageId = req.user.garage._id;
    log.info('Deleting inventory item', { itemId: id, garageId });
    await inventoryUsecase.removeItem({ itemId: id, garageId });
    log.info('Inventory item deleted', { itemId: id, garageId });
    res.status(200).json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    log.error('Failed to delete inventory item', { itemId: req.params.id, error: error.message });
    next(error);
  }
};
