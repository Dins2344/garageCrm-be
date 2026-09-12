import { and, eq, sql } from 'drizzle-orm';
import { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { Tx } from '../config/db';
import { garages, jobCards, invoices } from '../config/schema';

/**
 * Per-garage document numbers — `JC-YYMMDD-0001`, `INV-YYMMDD-0001`.
 *
 * The sequence continues from the **highest number already issued** in the
 * garage, not from a row count. The Mongoose hooks used `count + 1`, which
 * breaks the moment anything is deleted: with 0001-0003 issued and 0002
 * removed, the count is 2 and the next number is 0003 — already taken. Mongo
 * had no unique index on invoice numbers, so it silently issued the
 * duplicate; Postgres has one and refuses, which is how this surfaced in
 * production right after the cutover.
 *
 * The caller must be inside a transaction: the garage row is locked first,
 * so two concurrent creates in one garage serialise instead of both reading
 * the same maximum.
 */

const datePrefix = (): string => new Date().toISOString().slice(2, 10).replace(/-/g, '');

const lockGarage = async (tx: Tx, garageId: string): Promise<void> => {
  await tx.execute(sql`select id from garages where id = ${garageId} for update`);
};

/**
 * The highest `NNNN` suffix on this garage's numbers, 0 when there are none.
 * Only rows in the `PREFIX-YYMMDD-NNNN` shape are considered, so a hand-edited
 * or legacy value can never make the cast fail.
 */
const highestIssued = async (tx: Tx, table: PgTable, column: PgColumn, garageColumn: PgColumn, prefix: string, garageId: string): Promise<number> => {
  const pattern = `^${prefix}-[0-9]{6}-[0-9]+$`;
  const [{ max }] = await tx
    .select({ max: sql<number>`coalesce(max(cast(split_part(${column}, '-', 3) as integer)), 0)` })
    .from(table)
    .where(and(eq(garageColumn, garageId), sql`${column} ~ ${pattern}`));
  return Number(max) || 0;
};

const format = (prefix: string, sequence: number): string =>
  `${prefix}-${datePrefix()}-${String(sequence).padStart(4, '0')}`;

export const nextJobCardNumber = async (tx: Tx, garageId: string): Promise<string> => {
  await lockGarage(tx, garageId);
  const last = await highestIssued(tx, jobCards, jobCards.jobCardNumber, jobCards.garageId, 'JC', garageId);
  return format('JC', last + 1);
};

export const nextInvoiceNumber = async (tx: Tx, garageId: string): Promise<string> => {
  await lockGarage(tx, garageId);
  const last = await highestIssued(tx, invoices, invoices.invoiceNumber, invoices.garageId, 'INV', garageId);
  return format('INV', last + 1);
};

/** Sanity: the garage must exist for the lock to mean anything. */
export const garageExists = async (tx: Tx, garageId: string): Promise<boolean> => {
  const row = await tx.select({ _id: garages._id }).from(garages).where(eq(garages._id, garageId)).limit(1);
  return row.length > 0;
};
