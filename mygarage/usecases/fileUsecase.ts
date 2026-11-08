import { and, eq, ne, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { cloudFiles } from '../config/schema';
import * as r2 from '../services/r2';
import { HttpError } from '../../utils/httpError';
import logger from '../../utils/logger';

const log = logger.child('MyGarageFiles');

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const USER_QUOTA_BYTES = 1024 ** 3;
export const URL_TTL_SECONDS = 900;

const STORAGE_DOWN = 'File storage is unavailable right now. Try again later.';
const TOO_LARGE = 'This file is too large to back up (25 MB limit).';
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

const expiry = (): string => new Date(Date.now() + URL_TTL_SECONDS * 1000).toISOString();

export const requestUpload = async ({ userId, fileId, size }: { userId: string; fileId: string; size: number }): Promise<{ url: string; expiresAt: string }> => {
  if (size > MAX_FILE_BYTES) throw new HttpError(TOO_LARGE, 413);
  // Serialise per user so two requests cannot both pass the quota check.
  await mgDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);
    const [{ total }] = await tx.select({ total: sql<number>`coalesce(sum(${cloudFiles.size}), 0)::float8` })
      .from(cloudFiles)
      .where(and(eq(cloudFiles.userId, userId), ne(cloudFiles.fileId, fileId)));
    if (Number(total) + size > USER_QUOTA_BYTES) {
      throw new HttpError('Your cloud storage is full (1 GB). This file stays on your phone.', 413);
    }
    await tx.insert(cloudFiles)
      .values({ userId, fileId, size, status: 'pending' })
      .onConflictDoUpdate({ target: [cloudFiles.userId, cloudFiles.fileId], set: { size, status: 'pending', uploadedAt: null } });
  });
  const url = await storage(userId, fileId, () => r2.presignPut(r2.objectKey(userId, fileId), URL_TTL_SECONDS));
  return { url, expiresAt: expiry() };
};

export const completeUpload = async ({ userId, fileId }: { userId: string; fileId: string }): Promise<number> => {
  const [file] = await mgDb.select().from(cloudFiles).where(and(eq(cloudFiles.userId, userId), eq(cloudFiles.fileId, fileId)));
  if (!file) throw new HttpError(NOT_IN_CLOUD, 404);
  const key = r2.objectKey(userId, fileId);
  const size = await storage(userId, fileId, () => r2.headObjectSize(key));
  if (size === null) throw new HttpError('The upload did not finish. Try again.', 409);
  if (size > MAX_FILE_BYTES) {
    await storage(userId, fileId, () => r2.deleteObject(key));
    throw new HttpError(TOO_LARGE, 413);
  }
  await mgDb.update(cloudFiles).set({ size, status: 'uploaded', uploadedAt: new Date() })
    .where(and(eq(cloudFiles.userId, userId), eq(cloudFiles.fileId, fileId)));
  return size;
};

export const requestDownload = async ({ userId, fileId }: { userId: string; fileId: string }): Promise<{ url: string; expiresAt: string }> => {
  const [file] = await mgDb.select({ status: cloudFiles.status }).from(cloudFiles)
    .where(and(eq(cloudFiles.userId, userId), eq(cloudFiles.fileId, fileId)));
  if (!file || file.status !== 'uploaded') throw new HttpError(NOT_IN_CLOUD, 404);
  const url = await storage(userId, fileId, () => r2.presignGet(r2.objectKey(userId, fileId), URL_TTL_SECONDS));
  return { url, expiresAt: expiry() };
};

/** Object first, row second: a failure leaves the row so a later push can retry. */
export const removeCloudFile = async ({ userId, fileId }: { userId: string; fileId: string }): Promise<void> => {
  await r2.deleteObject(r2.objectKey(userId, fileId));
  await mgDb.delete(cloudFiles).where(and(eq(cloudFiles.userId, userId), eq(cloudFiles.fileId, fileId)));
};
