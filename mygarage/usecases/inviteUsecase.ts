import { and, eq, gt, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { garageInvites, garageMembers, users } from '../config/schema';
import { hashToken, newRefreshToken } from '../services/crypto';
import { mailerReady, sendInviteMail } from '../services/mailer';
import { requireOwner, roleIn, Role } from './garageUsecase';
import {
  ALREADY_INVITED, ALREADY_MEMBER, expired, GARAGE_FULL, INVITE_GONE, INVITE_TTL_MS, INVITES_UNAVAILABLE,
  MAX_PENDING, MAX_PEOPLE, normalizeEmail, SELF_INVITE, SEND_FAILED, TOO_MANY_PENDING, wrongAccount
} from '../models/Invite';
import { HttpError } from '../../utils/httpError';
import logger from '../../utils/logger';

const log = logger.child('MyGarageInvites');
const LINK_BASE = 'https://dctech.space/api/mygarage/invite/';

type Invite = typeof garageInvites.$inferSelect;

const count = async (where: ReturnType<typeof and>): Promise<number> =>
  (await mgDb.select({ n: sql<number>`count(*)::int` }).from(garageInvites).where(where))[0].n;

const emailOf = async (userId: string): Promise<string> => {
  const [u] = await mgDb.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return normalizeEmail(u.email);
};

const send = (invite: Pick<Invite, 'email' | 'inviterName' | 'garageName' | 'role' | 'expiresAt'>, token: string) =>
  sendInviteMail({
    to: invite.email, inviterName: invite.inviterName, garageName: invite.garageName,
    role: invite.role, link: LINK_BASE + token, expiresAt: invite.expiresAt
  });

export const createInvite = async ({ userId, garageId, email, role, garageName }: {
  userId: string; garageId: string; email: string; role: 'editor' | 'viewer'; garageName: string;
}): Promise<{ id: string; expiresAt: Date }> => {
  await requireOwner(userId, garageId);
  if (!mailerReady()) throw new HttpError(INVITES_UNAVAILABLE, 503);
  const [owner] = await mgDb.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId));
  if (normalizeEmail(owner.email) === email) throw new HttpError(SELF_INVITE, 400);
  const members = await mgDb.select({ email: users.email, role: garageMembers.role })
    .from(garageMembers).innerJoin(users, eq(users.id, garageMembers.userId)).where(eq(garageMembers.garageId, garageId));
  if (members.some((m) => normalizeEmail(m.email) === email)) throw new HttpError(ALREADY_MEMBER, 409);
  if (members.filter((m) => m.role !== 'owner').length >= MAX_PEOPLE) throw new HttpError(GARAGE_FULL, 409);
  const waiting = and(eq(garageInvites.garageId, garageId), eq(garageInvites.status, 'pending'));
  if (await count(and(waiting, eq(garageInvites.email, email)))) throw new HttpError(ALREADY_INVITED, 409);
  if (await count(and(waiting, gt(garageInvites.expiresAt, new Date()))) >= MAX_PENDING) throw new HttpError(TOO_MANY_PENDING, 429);

  const token = newRefreshToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [row] = await mgDb.insert(garageInvites).values({
    garageId, email, role, garageName, inviterName: owner.name ?? owner.email,
    tokenHash: hashToken(token), status: 'pending', expiresAt
  }).returning();
  try {
    await send(row, token);
  } catch {
    await mgDb.delete(garageInvites).where(eq(garageInvites.id, row.id));
    log.error('Invite email failed', { inviteId: row.id, garageId });
    throw new HttpError(SEND_FAILED, 502);
  }
  log.info('Invite sent', { inviteId: row.id, garageId });
  return { id: row.id, expiresAt };
};

const pendingById = async (inviteId: string): Promise<Invite> => {
  const [row] = await mgDb.select().from(garageInvites).where(eq(garageInvites.id, inviteId));
  if (!row || row.status !== 'pending') throw new HttpError(INVITE_GONE, 404);
  return row;
};

export const resendInvite = async ({ userId, inviteId }: { userId: string; inviteId: string }): Promise<{ expiresAt: Date }> => {
  const row = await pendingById(inviteId);
  await requireOwner(userId, row.garageId);
  if (!mailerReady()) throw new HttpError(INVITES_UNAVAILABLE, 503);
  const token = newRefreshToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [updated] = await mgDb.update(garageInvites).set({ tokenHash: hashToken(token), expiresAt })
    .where(and(eq(garageInvites.id, inviteId), eq(garageInvites.status, 'pending'))).returning();
  if (!updated) throw new HttpError(INVITE_GONE, 404);
  try {
    await send(updated, token);
  } catch {
    log.error('Invite email failed', { inviteId, garageId: row.garageId });
    throw new HttpError(SEND_FAILED, 502);
  }
  return { expiresAt };
};

export const cancelInvite = async ({ userId, inviteId }: { userId: string; inviteId: string }): Promise<void> => {
  const row = await pendingById(inviteId);
  await requireOwner(userId, row.garageId);
  await mgDb.update(garageInvites).set({ status: 'cancelled' })
    .where(and(eq(garageInvites.id, inviteId), eq(garageInvites.status, 'pending')));
};

export const listMyInvites = async ({ userId }: { userId: string }) =>
  mgDb.select({
    id: garageInvites.id, garageId: garageInvites.garageId, garageName: garageInvites.garageName,
    inviterName: garageInvites.inviterName, role: garageInvites.role, expiresAt: garageInvites.expiresAt
  }).from(garageInvites)
    .where(and(eq(garageInvites.email, await emailOf(userId)), eq(garageInvites.status, 'pending'), gt(garageInvites.expiresAt, new Date())));

/** The invite is only for the account whose email it names; everyone else gets the masked address. */
const requireInvitee = async (userId: string, row: Invite): Promise<void> => {
  if ((await emailOf(userId)) !== row.email) throw new HttpError(wrongAccount(row.email), 403);
};

const accept = async (userId: string, row: Invite): Promise<{ garageId: string; role: Role }> => {
  if (row.status !== 'pending') throw new HttpError(INVITE_GONE, 404);
  await requireInvitee(userId, row);
  if (Date.now() >= row.expiresAt.getTime()) throw new HttpError(expired(row.inviterName), 410);
  return mgDb.transaction(async (tx) => {
    const [claimed] = await tx.update(garageInvites).set({ status: 'accepted' })
      .where(and(eq(garageInvites.id, row.id), eq(garageInvites.status, 'pending'))).returning({ id: garageInvites.id });
    if (!claimed) throw new HttpError(INVITE_GONE, 404);
    await tx.insert(garageMembers).values({ garageId: row.garageId, userId, role: row.role }).onConflictDoNothing();
    const role = (await roleIn(userId, row.garageId, tx)) as Role;
    return { garageId: row.garageId, role };
  });
};

export const acceptInvite = async ({ userId, inviteId }: { userId: string; inviteId: string }) =>
  accept(userId, (await pendingById(inviteId)));

export const acceptByToken = async ({ userId, token }: { userId: string; token: string }) => {
  const [row] = await mgDb.select().from(garageInvites).where(eq(garageInvites.tokenHash, hashToken(token)));
  if (!row) throw new HttpError(INVITE_GONE, 404);
  return accept(userId, row);
};

export const declineInvite = async ({ userId, inviteId }: { userId: string; inviteId: string }): Promise<void> => {
  const row = await pendingById(inviteId);
  await requireInvitee(userId, row);
  await mgDb.update(garageInvites).set({ status: 'declined' })
    .where(and(eq(garageInvites.id, inviteId), eq(garageInvites.status, 'pending')));
};
