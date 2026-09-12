import { z } from 'zod';
import { inventory, EMPTY_SUPPLIER, Supplier } from '../config/schema';
import { INVENTORY_CATEGORIES } from '../types/domain';
import { requiredString, optionalString, boundedNumber } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

export { inventory };
export type InventoryRow = typeof inventory.$inferSelect;
export type NewInventory = typeof inventory.$inferInsert;
export type { Supplier as ISupplier };

const supplierSchema = z.object({
  name: optionalString(),
  phone: optionalString(),
  email: optionalString()
});

const categoryField = z.enum(INVENTORY_CATEGORIES, { error: `Category must be one of: ${INVENTORY_CATEGORIES.join(', ')}` });
const nonNegative = (message: string, floor: string) => boundedNumber(message, { min: [0, floor] });

export const createInventorySchema = z.object({
  partName: requiredString('Part name is required'),
  partNumber: optionalString(),
  category: categoryField.default('other'),
  quantity: nonNegative('Quantity must be a number', 'Quantity cannot be negative').default(0),
  threshold: nonNegative('Threshold must be a number', 'Threshold cannot be negative').default(5),
  unitPrice: nonNegative('Unit price is required', 'Unit price cannot be negative'),
  sellingPrice: nonNegative('Selling price must be a number', 'Selling price cannot be negative').default(0),
  supplier: supplierSchema.default(EMPTY_SUPPLIER),
  location: optionalString(),
  isActive: z.boolean().default(true)
});

export const updateInventorySchema = z.object({
  partName: requiredString('Part name is required').optional(),
  partNumber: z.string().trim().optional(),
  category: categoryField.optional(),
  quantity: nonNegative('Quantity must be a number', 'Quantity cannot be negative').optional(),
  threshold: nonNegative('Threshold must be a number', 'Threshold cannot be negative').optional(),
  unitPrice: nonNegative('Unit price is required', 'Unit price cannot be negative').optional(),
  sellingPrice: nonNegative('Selling price must be a number', 'Selling price cannot be negative').optional(),
  // Default-free on purpose — see `models/Garage.ts` on why `.partial()` will not do.
  supplier: z.object({
    name: z.string().trim().optional(),
    phone: z.string().trim().optional(),
    email: z.string().trim().optional()
  }).optional(),
  location: z.string().trim().optional(),
  isActive: z.boolean().optional()
});

/** `isLowStock` was a Mongoose virtual; the web Inventory page filters on it. */
export const inventoryToApi = (row: InventoryRow): ApiObject => ({
  ...serializeRow(row),
  isLowStock: row.quantity <= row.threshold
});
