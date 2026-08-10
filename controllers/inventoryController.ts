import { Request, Response, NextFunction } from 'express';
import * as inventoryUsecase from '../usecases/inventoryUsecase';
import logger from '../utils/logger';
const log = logger.child('InventoryController');

// @desc    Get all inventory
// @route   GET /api/inventory
export const getInventory = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { search, category, page, limit } = req.query as Record<string, string | undefined>;
    const garageId = req.user!.garage._id;
    log.info('Fetching inventory list', { garageId, search, category, page, limit });
    const { items, total } = await inventoryUsecase.getInventoryList({ garageId, search, category, page, limit });
    log.info('Inventory list fetched', { garageId, count: items.length, total });
    res.status(200).json({ success: true, count: items.length, total, data: items });
  } catch (error) {
    log.error('Failed to fetch inventory', { garageId: req.user?.garage?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get low stock alerts
// @route   GET /api/inventory/alerts
export const getLowStockAlerts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.user!.garage._id;
    log.info('Fetching low stock alerts', { garageId });
    const items = await inventoryUsecase.getLowStockItems({ garageId });
    log.info('Low stock alerts fetched', { garageId, count: items.length });
    res.status(200).json({ success: true, count: items.length, data: items });
  } catch (error) {
    log.error('Failed to fetch low stock alerts', { garageId: req.user?.garage?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get single inventory item
// @route   GET /api/inventory/:id
export const getInventoryItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Fetching inventory item', { itemId: id, garageId });
    const item = await inventoryUsecase.getItemDetails({ itemId: id, garageId });
    log.info('Inventory item fetched', { itemId: id });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to fetch inventory item', { itemId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Add item to inventory
// @route   POST /api/inventory
export const createInventoryItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.user!.garage._id;
    log.info('Creating inventory item', { garageId, partName: req.body.partName });
    const item = await inventoryUsecase.registerItem({ itemData: req.body, garageId });
    log.info('Inventory item created', { itemId: item._id, partName: item.partName, garageId });
    res.status(201).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to create inventory item', { garageId: req.user?.garage?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update inventory item
// @route   PUT /api/inventory/:id
export const updateInventoryItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Updating inventory item', { itemId: id, garageId, fields: Object.keys(req.body) });
    const item = await inventoryUsecase.updateItemData({ itemId: id, garageId, updateData: req.body });
    log.info('Inventory item updated', { itemId: id });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to update inventory item', { itemId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Adjust stock manually
// @route   PATCH /api/inventory/:id/stock
export const adjustStock = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Adjusting stock', { itemId: id, garageId, adjustment: req.body.adjustment, userId: req.user!._id });
    const item = await inventoryUsecase.adjustItemStock({
      itemId: id,
      garageId,
      adjustment: req.body.adjustment,
      userId: req.user!._id
    });
    log.info('Stock adjusted', { itemId: id, newQuantity: item.quantity });
    res.status(200).json({ success: true, data: item });
  } catch (error) {
    log.error('Failed to adjust stock', { itemId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Delete inventory item
// @route   DELETE /api/inventory/:id
export const deleteInventoryItem = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Deleting inventory item', { itemId: id, garageId });
    await inventoryUsecase.removeItem({ itemId: id, garageId });
    log.info('Inventory item deleted', { itemId: id, garageId });
    res.status(200).json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    log.error('Failed to delete inventory item', { itemId: req.params.id, error: (error as Error).message });
    next(error);
  }
};
