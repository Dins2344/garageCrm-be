import { QueryFilter, Types } from 'mongoose';
import Inventory, { IInventory } from '../models/Inventory';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('InventoryUsecase');

interface ListInput {
  garageId: Types.ObjectId | string;
  search?: string;
  category?: string;
  page?: number | string;
  limit?: number | string;
}

export const getInventoryList = async ({ garageId, search, category, page = 1, limit = 20 }: ListInput) => {
  const query: QueryFilter<IInventory> = { garage: garageId };

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
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit))
    .lean();

  return { items, total };
};

interface LowStockInput {
  garageId: Types.ObjectId | string;
}

/**
 * Items at or below their reorder threshold, for the /inventory/alerts endpoint.
 */
export const getLowStockItems = async ({ garageId }: LowStockInput) => {
  const items = await Inventory.find({
    garage: garageId,
    isActive: true,
    $expr: { $lte: ['$quantity', '$threshold'] }
  })
    .sort('quantity')
    .lean();

  log.info('Low stock alerts fetched', { garageId, count: items.length });
  return items;
};

interface GetDetailsInput {
  itemId: string;
  garageId: Types.ObjectId | string;
}

export const getItemDetails = async ({ itemId, garageId }: GetDetailsInput) => {
  const item = await Inventory.findOne({ _id: itemId, garage: garageId }).lean();
  if (!item) {
    throw new HttpError('Inventory item not found', 404);
  }
  return item;
};

interface RegisterInput {
  itemData: Partial<IInventory>;
  garageId: Types.ObjectId | string;
}

export const registerItem = async ({ itemData, garageId }: RegisterInput) => {
  const dataWithGarage = { ...itemData, garage: garageId };
  const item = await Inventory.create(dataWithGarage);
  log.info('New item added to inventory', { itemId: item._id, partName: item.partName });
  return item;
};

interface UpdateInput {
  itemId: string;
  garageId: Types.ObjectId | string;
  updateData: Partial<IInventory>;
}

export const updateItemData = async ({ itemId, garageId, updateData }: UpdateInput) => {
  const item = await Inventory.findOneAndUpdate(
    { _id: itemId, garage: garageId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!item) {
    throw new HttpError('Inventory item not found', 404);
  }

  return item;
};

interface AdjustStockInput {
  itemId: string;
  garageId: Types.ObjectId | string;
  adjustment: number | string;
  userId: Types.ObjectId | string;
}

export const adjustItemStock = async ({ itemId, garageId, adjustment, userId }: AdjustStockInput) => {
  const item = await Inventory.findOne({ _id: itemId, garage: garageId });

  if (!item) {
    throw new HttpError('Inventory item not found', 404);
  }

  const prevQuantity = item.quantity;
  item.quantity = Math.max(0, item.quantity + parseInt(String(adjustment), 10));
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

interface RemoveInput {
  itemId: string;
  garageId: Types.ObjectId | string;
}

export const removeItem = async ({ itemId, garageId }: RemoveInput): Promise<true> => {
  const item = await Inventory.findOneAndDelete({ _id: itemId, garage: garageId });
  if (!item) {
    throw new HttpError('Inventory item not found', 404);
  }
  return true;
};
