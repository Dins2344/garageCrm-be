import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MG_MIGRATIONS_FOLDER } from '../config/db';

const FILE = '0190f0a0-0000-7000-8000-000000000001';

const apply = async (db: PGlite, name: string): Promise<void> => {
  const sql = readFileSync(join(MG_MIGRATIONS_FOLDER, name), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) await db.exec(statement);
};

describe('migration 0001', () => {
  it('0001 moves existing rows to the personal scope', async () => {
    const db = new PGlite();
    await apply(db, '0000_init.sql');
    await db.exec(`insert into users (id, google_sub, email, wrapped_key) values ('u1', 'sub1', 'a@b.c', 'k')`);
    await db.exec(`insert into sync_records (user_id, tbl, id, updated_at, deleted_at, payload) values ('u1', 'vehicles', 'a', 10, null, 'QUJD')`);
    await db.exec(`insert into cloud_files (user_id, file_id, size, status) values ('u1', '${FILE}', 5, 'uploaded')`);
    await apply(db, '0001_sharing.sql');
    const rows = (await db.query('select scope, writer_id, tbl, id, payload from sync_records')).rows;
    const files = (await db.query('select scope, owner_id, file_id, size, status from cloud_files')).rows;
    expect(rows).toEqual([{ scope: 'u:u1', writer_id: 'u1', tbl: 'vehicles', id: 'a', payload: 'QUJD' }]);
    expect(files).toEqual([{ scope: 'u:u1', owner_id: 'u1', file_id: FILE, size: 5, status: 'uploaded' }]);
    await db.close();
  }, 60000);
});
