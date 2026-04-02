const Inventory = require('../models/Inventory');
const logger = require('../utils/logger');
const log = logger.child('InventoryUsecase');

exports.getInventoryList = async ({ garageId, search, category, page = 1, limit = 20 }) => {
  let query = { garage: garageId };

  if (search) {
    query.$or = [
      { partName: { $regex: search, $options: 'i' } },
      { partNumber: { $regex: search, $options: 'i' } }
    ];
  }

  if (category) {
    query.category = category;
  }

  const total = await Inventory.countDocuments(query);
  const items = await Inventory.find(query)
    .sort('-createdAt')
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  return { items, total };
};

exports.getItemDetails = async ({ itemId, garageId }) => {
  const item = await Inventory.findOne({ _id: itemId, garage: garageId }).lean();
  if (!item) {
    const error = new Error('Inventory item not found');
    error.statusCode = 404;
    throw error;
  }
  return item;
};

exports.registerItem = async ({ itemData, garageId }) => {
  itemData.garage = garageId;
  const item = await Inventory.create(itemData);
  log.info('New item added to inventory', { itemId: item._id, partName: item.partName });
  return item;
};

exports.updateItemData = async ({ itemId, garageId, updateData }) => {
  const item = await Inventory.findOneAndUpdate(
    { _id: itemId, garage: garageId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!item) {
    const error = new Error('Inventory item not found');
    error.statusCode = 404;
    throw error;
  }

  return item;
};

exports.adjustItemStock = async ({ itemId, garageId, adjustment, userId }) => {
  const item = await Inventory.findOne({ _id: itemId, garage: garageId });

  if (!item) {
    const error = new Error('Inventory item not found');
    error.statusCode = 404;
    throw error;
  }

  const prevQuantity = item.quantity;
  item.quantity = Math.max(0, item.quantity + parseInt(adjustment));
  await item.save();

  log.info('Stock adjusted manually', {
    itemId,
    partName: item.partName,
    prevQuantity,
    newQuantity: item.quantity,
    adjustment,
    adjBy: userId
  });

  return item;
};

exports.removeItem = async ({ itemId, garageId }) => {
  const item = await Inventory.findOneAndDelete({ _id: itemId, garage: garageId });
  if (!item) {
    const error = new Error('Inventory item not found');
    error.statusCode = 404;
    throw error;
  }
  return true;
};
