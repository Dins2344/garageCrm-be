import { describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { MG_MIGRATIONS_FOLDER } from '../config/db';
import { testDb, useMyGarageDb } from './harness';

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

describe('referral tables', () => {
  useMyGarageDb();

  it('deleting a user removes what is theirs and only unlinks them as a referrer', async () => {
    const db = testDb;
    const rows = async (q: string): Promise<unknown[]> => ((await db.execute(sql.raw(q))) as unknown as { rows: unknown[] }).rows;
    for (const id of ['r', 'f']) await db.execute(sql`insert into users (id, google_sub, email, wrapped_key) values (${id}, ${'sub' + id}, ${id + '@b.c'}, 'k')`);
    await db.execute(sql`insert into referral_codes (user_id, code) values ('r', 'MG-AAAAA'), ('f', 'MG-BBBBB')`);
    await db.execute(sql`insert into referrals (id, referrer_id, referee_id, source, status) values ('x', 'r', 'f', 'play', 'rewarded')`);
    await db.execute(sql`insert into plus_grants (id, user_id, reason, days, starts_at, ends_at, referral_id) values ('g', 'f', 'referral', 30, now(), now(), 'x')`);

    await db.execute(sql`delete from users where id = 'r'`);
    expect(await rows('select referrer_id from referrals')).toEqual([{ referrer_id: null }]);
    expect(await rows('select * from referral_codes')).toHaveLength(1);

    await db.execute(sql`delete from users where id = 'f'`);
    for (const t of ['referral_codes', 'referrals', 'plus_grants']) expect(await rows(`select * from ${t}`)).toHaveLength(0);
  });
});
