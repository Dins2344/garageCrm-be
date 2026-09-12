import { SQL, and, count, eq } from 'drizzle-orm';
import { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { db } from '../../config/db';
import * as schema from '../../config/schema';

/**
 * The handful of direct-database reads tests reach for around the API calls
 * they exercise — what `Model.findById` / `countDocuments` used to be.
 */

type TableWithId = PgTable & { _id: AnyPgColumn };
type TenantTable = PgTable & { garageId: AnyPgColumn };

export const findById = async <T extends TableWithId>(table: T, id: string): Promise<T['$inferSelect'] | null> => {
  const rows = await db.select().from(table as PgTable).where(eq(table._id, id)).limit(1);
  return (rows[0] as T['$inferSelect']) ?? null;
};

export const countRows = async (table: PgTable, where?: SQL): Promise<number> => {
  const [{ value }] = await db.select({ value: count() }).from(table).where(where);
  return value;
};

/** `count(*) where garage_id = $1 [and ...]` — the tenant-scoped count most tests want. */
export const countInGarage = async (table: TenantTable, garageId: string, extra?: SQL): Promise<number> =>
  countRows(table, and(eq(table.garageId, garageId), extra));

export { db, schema };
