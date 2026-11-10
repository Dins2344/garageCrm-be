import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { syncRecords } from '../models/SyncRecord';
import { removeCloudFile } from './fileUsecase';
import { isFileId } from '../services/ids';
import logger from '../../utils/logger';

const log = logger.child('MyGarageSync');

export type Change = { tbl: string; id: string; updatedAt: number; deletedAt: number | null; payload: string };

/** Last write wins on updatedAt. Returns the rows that were stored, so callers can act on them. */
export const pushChanges = async ({ userId, scope, changes }: { userId: string; scope: string; changes: Change[] }): Promise<{ accepted: Change[]; skipped: number }> => {
  const accepted = await mgDb.transaction(async (tx) => {
    // One push per user at a time: commit order must match seq order,
    // otherwise a pull can read a higher seq first and skip a row that commits later.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope}))`);
    const stored: Change[] = [];
    for (const change of changes) {
      const [row] = await tx.insert(syncRecords)
        .values({ ...change, scope, writerId: userId })
        .onConflictDoUpdate({
          target: [syncRecords.scope, syncRecords.tbl, syncRecords.id],
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
  // After commit, so R2 calls never hold the per-user lock. A failure leaves the cloud row, which the user's next upload request cleans up.
  for (const change of accepted) {
    if (change.tbl !== 'files' || change.deletedAt === null) continue;
    // The id is client-supplied and only length-limited; it must never reach an R2 key unless it is a UUID.
    if (!isFileId(change.id)) {
      log.warn('Skipped cloud removal for a files row with a non-UUID id', { userId });
      continue;
    }
    try {
      await removeCloudFile({ userId, scope, fileId: change.id });
    } catch {
      log.error('Cloud file removal failed', { userId, fileId: change.id });
    }
  }
  log.info('Pushed', { userId, accepted: accepted.length, skipped: changes.length - accepted.length });
  return { accepted, skipped: changes.length - accepted.length };
};

export const pullChanges = async ({ scope, since, limit }: { scope: string; since: number; limit: number }): Promise<{ changes: (Change & { seq: number })[]; next: number; more: boolean }> => {
  const rows = await mgDb.select({
    tbl: syncRecords.tbl,
    id: syncRecords.id,
    updatedAt: syncRecords.updatedAt,
    deletedAt: syncRecords.deletedAt,
    payload: syncRecords.payload,
    seq: syncRecords.seq
  })
    .from(syncRecords)
    .where(and(eq(syncRecords.scope, scope), gt(syncRecords.seq, since)))
    .orderBy(asc(syncRecords.seq))
    .limit(limit + 1);
  const changes = rows.slice(0, limit);
  return { changes, next: changes.length ? changes[changes.length - 1].seq : since, more: rows.length > limit };
};
