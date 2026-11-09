import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { ExtractTablesWithRelations } from 'drizzle-orm';
import * as schema from './schema';
import { loadMyGarageEnv, setMyGarageEnv, hasMyGarageEnv } from './env';
import logger from '../../utils/logger';

const log = logger.child('MyGarage');

/** Same shape as the GaragePulse Db type, so a Pool in production and PGlite in tests both fit. */
export type MgDb = PgDatabase<PgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;

let current: MgDb | null = null;

export const setMgDb = (instance: MgDb | null): void => {
  current = instance;
};

export const mgDb: MgDb = new Proxy({} as MgDb, {
  get(_target, prop) {
    if (!current) throw new Error('MyGarage database is not connected');
    const instance = current as unknown as Record<string | symbol, unknown>;
    const value = instance[prop];
    return typeof value === 'function' ? (value as Function).bind(instance) : value;
  }
});

/** From source (`mygarage/drizzle`) or from the image (`dist/mygarage/config` to `mygarage/drizzle`). */
export const MG_MIGRATIONS_FOLDER = [
  path.join(__dirname, '..', 'drizzle'),
  path.join(__dirname, '..', '..', '..', 'mygarage', 'drizzle')
].find(candidate => fs.existsSync(path.join(candidate, 'meta', '_journal.json')))
  ?? path.join(__dirname, '..', 'drizzle');

/** Name and code only: a failed migration's message includes SQL. */
const safeError = (e: unknown): { errorName: string; code?: unknown } => {
  const err = e as { name?: string; code?: unknown; cause?: { code?: unknown } } | null;
  const code = err?.code ?? err?.cause?.code;
  return { errorName: err?.name ?? 'Error', ...(code !== undefined && { code }) };
};

/** True only when both the settings and the database are in place. */
export const isMyGarageReady = (): boolean => hasMyGarageEnv() && current !== null;

/**
 * Connects and migrates the MyGarage database. Never throws and never exits:
 * any failure logs, releases the pool, leaves MyGarage off and returns false.
 */
export const connectMyGarage = async (): Promise<boolean> => {
  let pool: Pool | null = null;
  try {
    const env = loadMyGarageEnv();
    if (!env) return false;

    pool = new Pool({ connectionString: env.databaseUrl, max: 3, connectionTimeoutMillis: 5000 });
    // Without a listener, an error on an idle client would crash the whole process.
    pool.on('error', e => log.error('MyGarage pool error', safeError(e)));

    const instance = drizzle(pool, { schema, casing: 'snake_case' });
    await migrate(instance, { migrationsFolder: MG_MIGRATIONS_FOLDER });

    setMgDb(instance as unknown as MgDb);
    setMyGarageEnv(env);
    log.info('MyGarage database connected');
    return true;
  } catch (error) {
    log.error('MyGarage failed to start and is off', safeError(error));
    setMgDb(null);
    setMyGarageEnv(null);
    try { await pool?.end(); } catch { /* already failing; nothing more to release */ }
    return false;
  }
};
