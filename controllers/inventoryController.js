const inventoryUsecase = require('../usecases/inventoryUsecase');
const logger = require('../utils/logger');
const log = logger.child('InventoryController');

// @desc    Get all inventory
// @route   GET /api/inventory
exports.getInventory = async (req, res, next) => {
  try {
    const { search, category, page, limit } = req.query;
    const { items, total } = await inventoryUsecase.getInventoryList({
      garageId: req.user.garage._id,
      search,
      category,
      page,
      limit
    });

    res.status(200).json({
      success: true,
      count: items.length,
      total,
      data: items
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single inventory item
// @route   GET /api/inventory/:id
exports.getInventoryItem = async (req, res, next) => {
  try {
    const item = await inventoryUsecase.getItemDetails({
      itemId: req.params.id,
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

// @desc    Add item to inventory
// @route   POST /api/inventory
exports.createInventoryItem = async (req, res, next) => {
  try {
    const item = await inventoryUsecase.registerItem({
      itemData: req.body,
      garageId: req.user.garage._id
    });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

// @desc    Update inventory item
// @route   PUT /api/inventory/:id
exports.updateInventoryItem = async (req, res, next) => {
  try {
    const item = await inventoryUsecase.updateItemData({
      itemId: req.params.id,
      garageId: req.user.garage._id,
      updateData: req.body
    });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

// @desc    Adjust stock manually
// @route   PATCH /api/inventory/:id/stock
exports.adjustStock = async (req, res, next) => {
  try {
    const item = await inventoryUsecase.adjustItemStock({
      itemId: req.params.id,
      garageId: req.user.garage._id,
      adjustment: req.body.adjustment,
      userId: req.user._id
    });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete inventory item
// @route   DELETE /api/inventory/:id
exports.deleteInventoryItem = async (req, res, next) => {
  try {
    await inventoryUsecase.removeItem({
      itemId: req.params.id,
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    next(error);
  }
};
