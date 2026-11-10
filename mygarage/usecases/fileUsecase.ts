import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { cloudFiles, sharedGarages, syncRecords } from '../config/schema';
import { garageIdOf } from '../services/scope';
import * as r2 from '../services/r2';
import { HttpError } from '../../utils/httpError';
import logger from '../../utils/logger';

const log = logger.child('MyGarageFiles');

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const USER_QUOTA_BYTES = 1024 ** 3;
export const URL_TTL_SECONDS = 900;

const STORAGE_DOWN = 'File storage is unavailable right now. Try again later.';
const TOO_LARGE = 'This file is too large to back up (25 MB limit).';
const QUOTA_FULL = 'Your cloud storage is full (1 GB). This file stays on your phone.';
const NOT_IN_CLOUD = 'This file is not in the cloud yet.';

/** Runs an R2 call; any failure becomes a 502 with ids-only logging (signed URLs carry credentials). */
const storage = async <T>(userId: string, fileId: string, call: () => Promise<T>): Promise<T> => {
  try {
    return await call();
  } catch {
    log.error('R2 call failed', { userId, fileId });
    throw new HttpError(STORAGE_DOWN, 502);
  }
};

/** Whose quota a scope's files count against: the user for personal scope, the garage owner for a garage. */
export const ownerOf = async (scope: string, userId: string): Promise<string> => {
  const garageId = garageIdOf(scope);
  if (!garageId) return userId;
  const [garage] = await mgDb.select({ ownerId: sharedGarages.ownerId }).from(sharedGarages).where(eq(sharedGarages.id, garageId));
  if (!garage) throw new HttpError(NOT_IN_CLOUD, 404);
  return garage.ownerId;
};

const expiry = (): string => new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString();

/**
 * Cloud rows whose file was deleted on the phone (a failed R2 delete at push time leaves one)
 * would count against the quota forever. Delete the object, then the row; a failure keeps the row.
 * ponytail: runs before the transaction, never under the user lock (R2 calls take up to 10 s each, and holding a pool
 * connection through an outage would starve every user). Capped at 10 rows per request; the rest go on later uploads.
 */
const sweepDeletedFiles = async (db: Pick<typeof mgDb, 'select' | 'delete'>, userId: string, scope: string): Promise<void> => {
  const stale = await db.select({ fileId: cloudFiles.fileId }).from(cloudFiles)
    .innerJoin(syncRecords, and(
      eq(syncRecords.scope, cloudFiles.scope),
      eq(syncRecords.tbl, 'files'),
      eq(syncRecords.id, cloudFiles.fileId),
      sql`${syncRecords.deletedAt} is not null`))
    .where(eq(cloudFiles.scope, scope))
    .limit(10);
  const gone: string[] = [];
  for (const { fileId } of stale) {
    try {
      await r2.deleteObject(r2.objectKey(scope, fileId));
      gone.push(fileId);
    } catch {
      log.error('Cloud file cleanup failed', { userId, fileId });
    }
  }
  if (gone.length) await db.delete(cloudFiles).where(and(eq(cloudFiles.scope, scope), inArray(cloudFiles.fileId, gone)));
};

export const requestUpload = async ({ userId, scope, fileId, size }: { userId: string; scope: string; fileId: string; size: number }): Promise<{ url: string; expiresAt: string }> => {
  if (size > MAX_FILE_BYTES) throw new HttpError(TOO_LARGE, 413);
  await sweepDeletedFiles(mgDb, userId, scope);
  const owner = await ownerOf(scope, userId);
  // Serialise per user so two requests cannot both pass the quota check.
  await mgDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('q:' || ${owner}::text))`);
    const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(${cloudFiles.size}), 0)::float8` })
      .from(cloudFiles)
      .where(and(eq(cloudFiles.ownerId, owner), ne(cloudFiles.fileId, fileId)));
    if (Number(total) + size > USER_QUOTA_BYTES) {
      throw new HttpError(QUOTA_FULL, 413);
    }
    await tx.insert(cloudFiles)
      .values({ scope, ownerId: owner, fileId, size, status: 'pending' })
      .onConflictDoUpdate({ target: [cloudFiles.scope, cloudFiles.fileId], set: { size, status: 'pending', uploadedAt: null } });
  });
  const url = await storage(userId, fileId, () => r2.presignPut(r2.objectKey(scope, fileId), URL_TTL_SECONDS, size));
  return { url, expiresAt: expiry() };
};

export const completeUpload = async ({ userId, scope, fileId }: { userId: string; scope: string; fileId: string }): Promise<number> => {
  const [file] = await mgDb.select().from(cloudFiles).where(and(eq(cloudFiles.scope, scope), eq(cloudFiles.fileId, fileId)));
  if (!file) throw new HttpError(NOT_IN_CLOUD, 404);
  const key = r2.objectKey(scope, fileId);
  const owner = await ownerOf(scope, userId);
  const size = await storage(userId, fileId, () => r2.headObjectSize(key));
  if (size === null) throw new HttpError('The upload did not finish. Try again.', 409);
  if (size > MAX_FILE_BYTES) {
    await storage(userId, fileId, () => r2.deleteObject(key));
    throw new HttpError(TOO_LARGE, 413);
  }
  // The declared size may have been a lie, so the quota is checked again with the real one.
  const fits = await mgDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('q:' || ${owner}::text))`);
    const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(${cloudFiles.size}), 0)::float8` })
      .from(cloudFiles)
      .where(and(eq(cloudFiles.ownerId, owner), ne(cloudFiles.fileId, fileId)));
    if (Number(total) + size > USER_QUOTA_BYTES) return false;
    await tx.update(cloudFiles).set({ size, status: 'uploaded', uploadedAt: new Date() })
      .where(and(eq(cloudFiles.scope, scope), eq(cloudFiles.fileId, fileId)));
    return true;
  });
  if (!fits) {
    // Object first, row second: if the delete fails the row stays, so the quota still counts the object.
    await storage(userId, fileId, () => r2.deleteObject(key));
    await mgDb.delete(cloudFiles).where(and(eq(cloudFiles.scope, scope), eq(cloudFiles.fileId, fileId)));
    throw new HttpError(QUOTA_FULL, 413);
  }
  return size;
};

export const requestDownload = async ({ userId, scope, fileId }: { userId: string; scope: string; fileId: string }): Promise<{ url: string; expiresAt: string }> => {
  const [file] = await mgDb.select({ status: cloudFiles.status }).from(cloudFiles)
    .where(and(eq(cloudFiles.scope, scope), eq(cloudFiles.fileId, fileId)));
  if (!file || file.status !== 'uploaded') throw new HttpError(NOT_IN_CLOUD, 404);
  const url = await storage(userId, fileId, () => r2.presignGet(r2.objectKey(scope, fileId), URL_TTL_SECONDS));
  return { url, expiresAt: expiry() };
};

/** Object first, row second: a failure leaves the row, which the next upload request cleans up. */
export const removeCloudFile = async ({ scope, fileId }: { userId?: string; scope: string; fileId: string }): Promise<void> => {
  await r2.deleteObject(r2.objectKey(scope, fileId));
  await mgDb.delete(cloudFiles).where(and(eq(cloudFiles.scope, scope), eq(cloudFiles.fileId, fileId)));
};
