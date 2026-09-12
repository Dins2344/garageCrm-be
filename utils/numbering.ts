import { count, eq, sql } from 'drizzle-orm';
import { Tx } from '../config/db';
import { garages, jobCards, invoices } from '../config/schema';

/**
 * Per-garage document numbers — `JC-YYMMDD-0001`, `INV-YYMMDD-0001`.
 *
 * Same format and the same "count + 1" rule the Mongoose `pre('validate')`
 * hooks used, so numbering continues unbroken across the migration. The
 * difference is that it is now safe: the caller must be inside a transaction,
 * and the garage row is locked first, so two concurrent creates in one garage
 * serialise instead of both reading the same count and colliding on the
 * unique index. (The seeder used to have to create job cards one at a time
 * for exactly that reason.)
 */

const datePrefix = (): string => new Date().toISOString().slice(2, 10).replace(/-/g, '');

const lockGarage = async (tx: Tx, garageId: string): Promise<void> => {
  await tx.execute(sql`select id from garages where id = ${garageId} for update`);
};

export const nextJobCardNumber = async (tx: Tx, garageId: string): Promise<string> => {
  await lockGarage(tx, garageId);
  const [{ value }] = await tx.select({ value: count() }).from(jobCards).where(eq(jobCards.garageId, garageId));
  return `JC-${datePrefix()}-${String(value + 1).padStart(4, '0')}`;
};

export const nextInvoiceNumber = async (tx: Tx, garageId: string): Promise<string> => {
  await lockGarage(tx, garageId);
  const [{ value }] = await tx.select({ value: count() }).from(invoices).where(eq(invoices.garageId, garageId));
  return `INV-${datePrefix()}-${String(value + 1).padStart(4, '0')}`;
};

/** Sanity: the garage must exist for the lock to mean anything. */
export const garageExists = async (tx: Tx, garageId: string): Promise<boolean> => {
  const row = await tx.select({ _id: garages._id }).from(garages).where(eq(garages._id, garageId)).limit(1);
  return row.length > 0;
};
