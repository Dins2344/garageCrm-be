import { z } from 'zod';
import { invoices, EstimationPart } from '../config/schema';
import { PAYMENT_STATUSES, PAYMENT_METHODS } from '../types/domain';
import { boundedNumber } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

export { invoices };
export type InvoiceRow = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;

/** What a payment update may carry; the usecase derives `paymentStatus` when absent. */
export const paymentUpdateSchema = z.object({
  paymentStatus: z.enum(PAYMENT_STATUSES, { error: `Payment status must be one of: ${PAYMENT_STATUSES.join(', ')}` }).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS, { error: `Payment method must be one of: ${PAYMENT_METHODS.filter(Boolean).join(', ')}` }).optional(),
  amountPaid: boundedNumber('Amount paid must be a number', { min: [0, 'Amount paid cannot be negative'] }).optional(),
  notes: z.string().trim().optional()
});

export interface InvoiceLookups {
  inventoryById?: Map<string, ApiObject>;
}

/** Same JSONB-reference treatment as `jobCardToApi`, for `parts[].inventoryItem`. */
export const invoiceToApi = (row: object, lookups: InvoiceLookups = {}): ApiObject => {
  const out = serializeRow(row);

  if (lookups.inventoryById && Array.isArray(out.parts)) {
    out.parts = (out.parts as EstimationPart[]).map(part => ({
      ...part,
      inventoryItem: (part.inventoryItem && lookups.inventoryById!.get(part.inventoryItem)) || part.inventoryItem
    }));
  }

  return out;
};
