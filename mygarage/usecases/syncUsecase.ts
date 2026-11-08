import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { syncRecords } from '../models/SyncRecord';
import logger from '../../utils/logger';

const log = logger.child('MyGarageSync');

export type Change = { tbl: string; id: string; updatedAt: number; deletedAt: number | null; payload: string };

/** Last write wins on updatedAt. Returns the rows that were stored, so callers can act on them. */
export const pushChanges = async ({ userId, changes }: { userId: string; changes: Change[] }): Promise<{ accepted: Change[]; skipped: number }> => {
  const accepted = await mgDb.transaction(async (tx) => {
    // One push per user at a time: commit order must match seq order,
    // otherwise a pull can read a higher seq first and skip a row that commits later.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const stored: Change[] = [];
    for (const change of changes) {
      const [row] = await tx.insert(syncRecords)
        .values({ userId, ...change })
        .onConflictDoUpdate({
          target: [syncRecords.userId, syncRecords.tbl, syncRecords.id],
          set: {
            updatedAt: change.updatedAt,
            deletedAt: change.deletedAt,
            payload: change.payload,
            seq: sql`nextval('sync_seq')`
          },
          setWhere: sql`${syncRecords.updatedAt} < excluded.updated_at`
        })
        .returning({ id: syncRecords.id });
      if (row) stored.push(change);
    }
    return stored;
  });
  log.info('Pushed', { userId, accepted: accepted.length, skipped: changes.length - accepted.length });
  return { accepted, skipped: changes.length - accepted.length };
};

export const pullChanges = async ({ userId, since, limit }: { userId: string; since: number; limit: number }): Promise<{ changes: (Change & { seq: number })[]; next: number; more: boolean }> => {
  const rows = await mgDb.select({
    tbl: syncRecords.tbl,
    id: syncRecords.id,
    updatedAt: syncRecords.updatedAt,
    deletedAt: syncRecords.deletedAt,
    payload: syncRecords.payload,
    seq: syncRecords.seq
  })
    .from(syncRecords)
    .where(and(eq(syncRecords.userId, userId), gt(syncRecords.seq, since)))
    .orderBy(asc(syncRecords.seq))
    .limit(limit + 1);
  const changes = rows.slice(0, limit);
  return { changes, next: changes.length ? changes[changes.length - 1].seq : since, more: rows.length > limit };
};
