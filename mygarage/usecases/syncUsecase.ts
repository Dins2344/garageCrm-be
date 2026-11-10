import { and, asc, eq, gt, or, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { syncRecords } from '../models/SyncRecord';
import { removeCloudFile } from './fileUsecase';
import { isFileId } from '../services/ids';
import { personalScope, garageScope, toWire, WIRE_PERSONAL } from '../services/scope';
import { roleIn, readableGarageIds, Role } from './garageUsecase';
import logger from '../../utils/logger';

const log = logger.child('MyGarageSync');

export type Change = { tbl: string; id: string; updatedAt: number; deletedAt: number | null; payload: string };

type Rejected = { scope: string; tbl: string; id: string };

/** Last write wins on updatedAt, one transaction for all groups. Returns the rows stored per scope, so callers can act on them. */
const storeGroups = async (userId: string, groups: Map<string, Change[]>): Promise<Map<string, Change[]>> => {
  const stored = await mgDb.transaction(async (tx) => {
    const out = new Map<string, Change[]>();
    // Sorted lock order, so two pushes touching the same scopes cannot deadlock.
    for (const scope of [...groups.keys()].sort()) {
      // One push per scope at a time: commit order must match seq order,
      // otherwise a pull can read a higher seq first and skip a row that commits later.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope}))`);
      const done: Change[] = [];
      for (const change of groups.get(scope) ?? []) {
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
        if (row) done.push(change);
      }
      out.set(scope, done);
    }
    return out;
  });
  // After commit, so R2 calls never hold the scope lock. A failure leaves the cloud row, which the user's next upload request cleans up.
  for (const [scope, accepted] of stored) {
    for (const change of accepted) {
      if (change.tbl !== 'files' || change.deletedAt === null) continue;
      // The id is client-supplied and only length-limited; it must never reach an R2 key unless it is a UUID.
      if (!isFileId(change.id)) {
        log.warn('Skipped cloud removal for a files row with a non-UUID id', { userId });
        continue;
      }
      try {
        await removeCloudFile({ scope, fileId: change.id });
      } catch {
        log.error('Cloud file removal failed', { userId, fileId: change.id });
      }
    }
  }
  return stored;
};

export const pushChanges = async ({ userId, scope, changes }: { userId: string; scope: string; changes: Change[] }): Promise<{ accepted: Change[]; skipped: number }> => {
  const accepted = (await storeGroups(userId, new Map([[scope, changes]]))).get(scope) ?? [];
  log.info('Pushed', { userId, accepted: accepted.length, skipped: changes.length - accepted.length });
  return { accepted, skipped: changes.length - accepted.length };
};

/** Writes to many scopes at once. Rejected changes are never stored: viewers and outsiders cannot write, and only the owner can touch a garage's own `garages` row. */
export const pushScoped = async ({ userId, changes }: { userId: string; changes: (Change & { scope: string })[] }): Promise<{ accepted: Change[]; skipped: number; rejected: Rejected[] }> => {
  const roles = new Map<string, Role | null>();
  for (const garageId of new Set(changes.map((c) => c.scope).filter((s) => s !== WIRE_PERSONAL))) roles.set(garageId, await roleIn(userId, garageId));
  const groups = new Map<string, Change[]>();
  const rejected: Rejected[] = [];
  let allowed = 0;
  for (const { scope, ...change } of changes) {
    const role = scope === WIRE_PERSONAL ? 'owner' : roles.get(scope);
    const ok = scope === WIRE_PERSONAL
      || ((role === 'owner' || role === 'editor') && (change.tbl !== 'garages' || (change.id === scope && role === 'owner')));
    if (!ok) {
      rejected.push({ scope, tbl: change.tbl, id: change.id });
      continue;
    }
    allowed++;
    const stored = scope === WIRE_PERSONAL ? personalScope(userId) : garageScope(scope);
    groups.set(stored, [...(groups.get(stored) ?? []), change]);
  }
  const accepted = [...(await storeGroups(userId, groups)).values()].flat();
  log.info('Pushed scoped', { userId, accepted: accepted.length, rejected: rejected.length });
  return { accepted, skipped: allowed - accepted.length, rejected };
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

/** Pulls from 'personal' and every garage the user is in, in seq order. Cursors for other scopes are ignored. */
export const pullScoped = async ({ userId, cursors, limit }: { userId: string; cursors: Record<string, number>; limit: number }): Promise<{ changes: (Change & { scope: string; seq: number })[]; cursors: Record<string, number>; more: boolean }> => {
  const wires = [WIRE_PERSONAL, ...(await readableGarageIds(userId))];
  const out: Record<string, number> = {};
  for (const wire of wires) out[wire] = cursors[wire] ?? 0;
  const rows = await mgDb.select({
    scope: syncRecords.scope,
    tbl: syncRecords.tbl,
    id: syncRecords.id,
    updatedAt: syncRecords.updatedAt,
    deletedAt: syncRecords.deletedAt,
    payload: syncRecords.payload,
    seq: syncRecords.seq
  })
    .from(syncRecords)
    .where(or(...wires.map((wire) => and(eq(syncRecords.scope, wire === WIRE_PERSONAL ? personalScope(userId) : garageScope(wire)), gt(syncRecords.seq, out[wire])))))
    .orderBy(asc(syncRecords.seq))
    .limit(limit + 1);
  const changes = rows.slice(0, limit).map((r) => ({ ...r, scope: toWire(r.scope) }));
  // Ascending seq, so the last row seen per scope is that scope's new cursor.
  for (const c of changes) out[c.scope] = c.seq;
  return { changes, cursors: out, more: rows.length > limit };
};
