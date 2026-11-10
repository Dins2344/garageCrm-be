import { and, eq, inArray, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { getMyGarageEnv } from '../config/env';
import { cloudFiles, garageInvites, garageMembers, sharedGarages, syncRecords, users } from '../config/schema';
import { newDataKey, unwrapKey, wrapKey } from '../services/crypto';
import { deleteObject, objectKey } from '../services/r2';
import { garageScope, personalScope } from '../services/scope';
import { removeCloudFile } from './fileUsecase';
import { NO_ACCESS, NOT_A_MEMBER, OWNER_FIXED, OWNER_ONLY, TAKEN } from '../models/Garage';
import { HttpError } from '../../utils/httpError';
import logger from '../../utils/logger';

const log = logger.child('MyGarageGarages');

export type Role = 'owner' | 'editor' | 'viewer';
const R2_DELETE_CHUNK = 10;

export const roleIn = async (userId: string, garageId: string, db: Pick<typeof mgDb, 'select'> = mgDb): Promise<Role | null> => {
  const [row] = await db.select({ role: garageMembers.role }).from(garageMembers)
    .where(and(eq(garageMembers.garageId, garageId), eq(garageMembers.userId, userId)));
  return row?.role ?? null;
};

export const readableGarageIds = async (userId: string): Promise<string[]> =>
  (await mgDb.select({ id: garageMembers.garageId }).from(garageMembers).where(eq(garageMembers.userId, userId))).map((r) => r.id);

export const isInAnyGarage = async (userId: string): Promise<boolean> =>
  (await mgDb.select({ id: garageMembers.garageId }).from(garageMembers).where(eq(garageMembers.userId, userId)).limit(1)).length > 0;

export const requireMember = async (userId: string, garageId: string): Promise<Role> => {
  const role = await roleIn(userId, garageId);
  if (!role) throw new HttpError(NO_ACCESS, 403);
  return role;
};

export const requireOwner = async (userId: string, garageId: string): Promise<void> => {
  if ((await requireMember(userId, garageId)) !== 'owner') throw new HttpError(OWNER_ONLY, 403);
};

const keyOf = (wrapped: string): string => unwrapKey(wrapped, getMyGarageEnv().masterKey).toString('base64');

export const shareGarage = async ({ userId, garageId }: { userId: string; garageId: string }): Promise<{ key: string }> =>
  mgDb.transaction(async (tx) => {
    await tx.insert(sharedGarages)
      .values({ id: garageId, ownerId: userId, wrappedKey: wrapKey(newDataKey(), getMyGarageEnv().masterKey) })
      .onConflictDoNothing();
    const [garage] = await tx.select().from(sharedGarages).where(eq(sharedGarages.id, garageId));
    if (garage.ownerId !== userId) throw new HttpError(TAKEN, 409);
    await tx.insert(garageMembers).values({ garageId, userId, role: 'owner' }).onConflictDoNothing();
    return { key: keyOf(garage.wrappedKey) };
  });

export const listGarages = async ({ userId }: { userId: string }): Promise<{ garageId: string; role: Role; ownerName: string }[]> => {
  const rows = await mgDb.select({ garageId: garageMembers.garageId, role: garageMembers.role, name: users.name, email: users.email })
    .from(garageMembers)
    .innerJoin(sharedGarages, eq(sharedGarages.id, garageMembers.garageId))
    .innerJoin(users, eq(users.id, sharedGarages.ownerId))
    .where(eq(garageMembers.userId, userId));
  return rows.map((r) => ({ garageId: r.garageId, role: r.role, ownerName: r.name ?? r.email }));
};

export const garageKey = async ({ userId, garageId }: { userId: string; garageId: string }): Promise<string> => {
  await requireMember(userId, garageId);
  const [garage] = await mgDb.select({ wrappedKey: sharedGarages.wrappedKey }).from(sharedGarages).where(eq(sharedGarages.id, garageId));
  return keyOf(garage.wrappedKey);
};

export const listPeople = async ({ userId, garageId }: { userId: string; garageId: string }) => {
  await requireOwner(userId, garageId);
  const members = await mgDb.select({ userId: users.id, email: users.email, name: users.name, role: garageMembers.role })
    .from(garageMembers).innerJoin(users, eq(users.id, garageMembers.userId))
    .where(eq(garageMembers.garageId, garageId));
  const invites = await mgDb.select({ id: garageInvites.id, email: garageInvites.email, role: garageInvites.role, expiresAt: garageInvites.expiresAt })
    .from(garageInvites).where(and(eq(garageInvites.garageId, garageId), eq(garageInvites.status, 'pending')));
  return { members, invites };
};

const requireChangeable = async (garageId: string, memberId: string): Promise<void> => {
  const role = await roleIn(memberId, garageId);
  if (!role) throw new HttpError(NOT_A_MEMBER, 404);
  if (role === 'owner') throw new HttpError(OWNER_FIXED, 403);
};

export const setRole = async ({ userId, garageId, memberId, role }: { userId: string; garageId: string; memberId: string; role: 'editor' | 'viewer' }): Promise<void> => {
  await requireOwner(userId, garageId);
  await requireChangeable(garageId, memberId);
  await mgDb.update(garageMembers).set({ role }).where(and(eq(garageMembers.garageId, garageId), eq(garageMembers.userId, memberId)));
};

export const removeMember = async ({ userId, garageId, memberId }: { userId: string; garageId: string; memberId: string }): Promise<void> => {
  if (memberId === userId) {
    if ((await requireMember(userId, garageId)) === 'owner') throw new HttpError(OWNER_FIXED, 403);
  } else {
    await requireOwner(userId, garageId);
    await requireChangeable(garageId, memberId);
  }
  await mgDb.delete(garageMembers).where(and(eq(garageMembers.garageId, garageId), eq(garageMembers.userId, memberId)));
};

/** R2 objects first, then rows; a failure keeps everything else so a retry finishes the job. */
export const deleteSharedGarage = async ({ garageId }: { garageId: string }): Promise<void> => {
  const scope = garageScope(garageId);
  const files = await mgDb.select({ fileId: cloudFiles.fileId }).from(cloudFiles).where(eq(cloudFiles.scope, scope));
  for (let i = 0; i < files.length; i += R2_DELETE_CHUNK) {
    const chunk = files.slice(i, i + R2_DELETE_CHUNK);
    const results = await Promise.allSettled(chunk.map(({ fileId }) => deleteObject(objectKey(scope, fileId))));
    const gone = chunk.filter((_, n) => results[n].status === 'fulfilled').map((f) => f.fileId);
    if (gone.length) await mgDb.delete(cloudFiles).where(and(eq(cloudFiles.scope, scope), inArray(cloudFiles.fileId, gone)));
    if (gone.length < chunk.length) {
      log.error('Garage deletion stopped at a file', { garageId, files: files.length });
      throw new HttpError('Could not delete the garage files. Try again.', 502);
    }
  }
  // Same lock key as a push to this scope, so a racing push cannot leave rows behind the garage.
  await mgDb.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope}))`);
    await tx.delete(syncRecords).where(eq(syncRecords.scope, scope));
    await tx.delete(sharedGarages).where(eq(sharedGarages.id, garageId));
  });
  log.info('Garage deleted', { garageId, files: files.length });
};

export const deleteGarage = async ({ userId, garageId }: { userId: string; garageId: string }): Promise<void> => {
  await requireOwner(userId, garageId);
  await deleteSharedGarage({ garageId });
};

/** After converting to a shared garage: drop the owner's personal copies that now exist in the garage. */
export const releasePersonal = async ({ userId, garageId, records, fileIds }: {
  userId: string; garageId: string; records: { tbl: string; id: string }[]; fileIds: string[];
}): Promise<{ released: number; kept: number }> => {
  await requireOwner(userId, garageId);
  const mine = personalScope(userId);
  const theirs = garageScope(garageId);
  let released = 0;
  const byTable = new Map<string, string[]>();
  for (const { tbl, id } of records) byTable.set(tbl, [...(byTable.get(tbl) ?? []), id]);
  for (const [tbl, ids] of byTable) {
    const inGarage = (await mgDb.select({ id: syncRecords.id }).from(syncRecords)
      .where(and(eq(syncRecords.scope, theirs), eq(syncRecords.tbl, tbl), inArray(syncRecords.id, ids)))).map((r) => r.id);
    if (!inGarage.length) continue;
    released += (await mgDb.delete(syncRecords)
      .where(and(eq(syncRecords.scope, mine), eq(syncRecords.tbl, tbl), inArray(syncRecords.id, inGarage))).returning({ id: syncRecords.id })).length;
  }
  const files = new Set(fileIds);
  for (const fileId of files) {
    const [copy] = await mgDb.select({ fileId: cloudFiles.fileId }).from(cloudFiles)
      .where(and(eq(cloudFiles.scope, theirs), eq(cloudFiles.fileId, fileId), eq(cloudFiles.status, 'uploaded')));
    if (!copy) continue;
    const [own] = await mgDb.select({ fileId: cloudFiles.fileId }).from(cloudFiles)
      .where(and(eq(cloudFiles.scope, mine), eq(cloudFiles.fileId, fileId)));
    if (!own) continue;
    try {
      await removeCloudFile({ scope: mine, fileId });
      released++;
    } catch {
      log.error('Personal file release failed', { userId, garageId, fileId });
    }
  }
  return { released, kept: new Set(records.map((r) => `${r.tbl}/${r.id}`)).size + files.size - released };
};
