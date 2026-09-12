import { z } from 'zod';
import { customers, EMPTY_ADDRESS } from '../config/schema';
import { requiredString, optionalString } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';
import { addressSchema } from './Garage';

export { customers };
export type CustomerRow = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export const createCustomerSchema = z.object({
  name: requiredString('Customer name is required'),
  phone: requiredString('Phone number is required'),
  email: optionalString(),
  address: addressSchema.default(EMPTY_ADDRESS),
  notes: optionalString()
});

export const updateCustomerSchema = z.object({
  name: requiredString('Customer name is required').optional(),
  phone: requiredString('Phone number is required').optional(),
  email: z.string().trim().optional(),
  address: addressSchema.optional(),
  notes: z.string().trim().optional()
});

/**
 * `vehicles` used to be a denormalised array of ids on the document, and it
 * drifted — see the vehicle-ownership note in CLAUDE.md. It is derived now:
 * whatever the query joined under `vehicles` is emitted (both clients render
 * its `.length`), and a row fetched without the join reports `[]`.
 */
export const customerToApi = (row: object): ApiObject => {
  const out = serializeRow(row);
  if (!Array.isArray(out.vehicles)) out.vehicles = [];
  return out;
};
