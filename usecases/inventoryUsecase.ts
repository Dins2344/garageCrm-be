import { and, asc, count, desc, eq, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../config/db';
import { inventory, createInventorySchema, updateInventorySchema, inventoryToApi } from '../models/Inventory';
import { runSchema } from '../utils/validation';
import { containsPattern, pagination } from '../utils/query';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('InventoryUsecase');

interface ListInput {
  garageId: string;
  search?: string;
  category?: string;
  page?: number | string;
  limit?: number | string;
}

export const getInventoryList = async ({ garageId, search, category, page = 1, limit = 20 }: ListInput) => {
  const paging = pagination(page, limit);
  const where = and(
    eq(inventory.garageId, garageId),
    search
      ? or(ilike(inventory.partName, containsPattern(search)), ilike(inventory.partNumber, containsPattern(search)))
      : undefined,
    category ? eq(inventory.category, category) : undefined
  );

  const [{ total }] = await db.select({ total: count() }).from(inventory).where(where);
  const items = await db.select().from(inventory)
    .where(where)
    .orderBy(desc(inventory.createdAt))
    .offset(paging.offset)
    .limit(paging.limit);

  return { items: items.map(inventoryToApi), total };
};

interface LowStockInput {
  garageId: string;
}

/**
 * Items at or below their reorder threshold, for the /inventory/alerts endpoint.
 */
export const getLowStockItems = async ({ garageId }: LowStockInput): Promise<ApiObject[]> => {
  const items = await db.select().from(inventory)
    .where(and(eq(inventory.garageId, garageId), eq(inventory.isActive, true), lte(inventory.quantity, inventory.threshold)))
    .orderBy(asc(inventory.quantity));

  log.info('Low stock alerts fetched', { garageId, count: items.length });
  return items.map(inventoryToApi);
};

interface GetDetailsInput {
  itemId: string;
  garageId: string;
}

export const getItemDetails = async ({ itemId, garageId }: GetDetailsInput): Promise<ApiObject> => {
  const item = await db.query.inventory.findFirst({
    where: and(eq(inventory._id, itemId), eq(inventory.garageId, garageId))
  });
  if (!item) {
    throw new HttpError('Inventory item not found', 404);
  }
  return inventoryToApi(item);
};

interface RegisterInput {
  itemData: Record<string, unknown>;
  garageId: string;
}

export const registerItem = async ({ itemData, garageId }: RegisterInput): Promise<ApiObject> => {
  const input = runSchema(createInventorySchema, itemData);
  const [item] = await db.insert(inventory).values({ ...input, garageId }).returning();
  log.info('New item added to inventory', { itemId: item._id, partName: item.partName });
  return inventoryToApi(item);
};

interface UpdateInput {
  itemId: string;
  garageId: string;
  updateData: Record<string, unknown>;
}

export const updateItemData = async ({ itemId, garageId, updateData }: UpdateInput): Promise<ApiObject> => {
  const { supplier, ...changes } = runSchema(updateInventorySchema, updateData);
  const scope = and(eq(inventory._id, itemId), eq(inventory.garageId, garageId));

  const set: Record<string, unknown> = { ...changes };
  if (supplier && Object.keys(supplier).length > 0) {
    set.supplier = sql`${inventory.supplier} || ${JSON.stringify(supplier)}::jsonb`;
  }

  const item = Object.keys(set).length === 0
    ? await db.query.inventory.findFirst({ where: scope })
    : (await db.update(inventory).set(set).where(scope).returning())[0];

  if (!item) {
    throw new HttpError('Inventory item not found', 404);
  }

  return inventoryToApi(item);
};

interface AdjustStockInput {
  itemId: string;
  garageId: string;
  adjustment: number | string;
  userId: string;
}

export const adjustItemStock = async ({ itemId, garageId, adjustment, userId }: AdjustStockInput): Promise<ApiObject> => {
  const scope = and(eq(inventory._id, itemId), eq(inventory.garageId, garageId));
  const delta = parseInt(String(adjustment), 10) || 0;

  // One statement, floored at zero, so two concurrent adjustments cannot both
  // read the same starting quantity.
  const [item] = await db.update(inventory)
    .set({ quantity: sql`greatest(0, ${inventory.quantity} + ${delta})` })
    .where(scope)
    .returning();

  if (!item) {
    throw new HttpError('Inventory item not found', 404);
  }

  log.info('Stock adjusted manually', {
    itemId,
    partName: item.partName,
    prevQuantity: Math.max(0, item.quantity - delta),
    newQuantity: item.quantity,
    adjustment,
    adjBy: userId
  });

  return inventoryToApi(item);
};

interface RemoveInput {
  itemId: string;
  garageId: string;
}

export const removeItem = async ({ itemId, garageId }: RemoveInput): Promise<true> => {
  const deleted = await db.delete(inventory)
    .where(and(eq(inventory._id, itemId), eq(inventory.garageId, garageId)))
    .returning({ _id: inventory._id });
  if (deleted.length === 0) {
    throw new HttpError('Inventory item not found', 404);
  }
  return true;
};
