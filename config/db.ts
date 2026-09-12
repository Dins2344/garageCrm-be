import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgDatabase, PgQueryResultHKT, PgTransaction } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import * as schema from './schema';
import logger from '../utils/logger';

const log = logger.child('Database');

/**
 * The database handle every usecase imports.
 *
 * Typed against the generic `PgDatabase` rather than the node-postgres
 * flavour so the same code runs on a `pg.Pool` in production and on an
 * in-process PGlite in tests. `tests/setup.ts` calls `setDb()` with the PGlite
 * instance before any test file loads; `server.ts` calls `connectDB()` before
 * `app.listen()`. Either way the handle is bound before the first query.
 *
 * `db` itself is a thin proxy onto whichever instance is current, so usecases
 * write `db.select()` and never have to ask for the connection.
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;
export type Tx = PgTransaction<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;
/** Accepts either, so a helper can run standalone or inside a caller's transaction. */
export type DbOrTx = Db | Tx;

let current: Db | null = null;
let pool: Pool | null = null;

export const setDb = (instance: Db): void => {
  current = instance;
};

export const getDb = (): Db => {
  if (!current) {
    throw new Error('Database not initialised — connectDB() (or the test harness) has not run');
  }
  return current;
};

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const instance = getDb() as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === 'function' ? (value as Function).bind(instance) : value;
  }
});

/**
 * Where the SQL migrations live, from either layout: `config/db.ts` in source
 * (`../drizzle`) or `dist/config/db.js` in the image (`../../drizzle`, since
 * the Dockerfile copies `drizzle/` beside `dist/`, not inside it).
 */
export const MIGRATIONS_FOLDER = [
  path.join(__dirname, '..', 'drizzle'),
  path.join(__dirname, '..', '..', 'drizzle')
].find(candidate => fs.existsSync(path.join(candidate, 'meta', '_journal.json')))
  ?? path.join(__dirname, '..', 'drizzle');

const connectDB = async (): Promise<void> => {
  try {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }

    // Neon's free tier caps connections; the pooled connection string plus a
    // small local pool keeps a single instance well inside it.
    pool = new Pool({ connectionString, max: 5 });
    const instance = drizzle(pool, { schema, casing: 'snake_case' });

    // Schema migrations apply at boot. Single instance, so there is no race,
    // and a migration that cannot apply fails the start instead of leaving a
    // constraint silently unenforced.
    await migrate(instance, { migrationsFolder: MIGRATIONS_FOLDER });

    setDb(instance);
    log.info('PostgreSQL connection established', { host: new URL(connectionString).hostname });
  } catch (error) {
    log.error('PostgreSQL connection failed', { error: (error as Error).message });
    process.exit(1);
  }
};

/** Health-check probe: true when a round trip succeeds. */
export const pingDb = async (): Promise<boolean> => {
  try {
    await getDb().execute('select 1');
    return true;
  } catch {
    return false;
  }
};

export const closeDB = async (): Promise<void> => {
  await pool?.end();
  pool = null;
  current = null;
};

export default connectDB;
