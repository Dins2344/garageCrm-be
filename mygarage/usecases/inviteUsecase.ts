import { and, eq, gt, lt, ne, sql } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { garageInvites, garageMembers, users } from '../config/schema';
import { hashToken, newRefreshToken } from '../services/crypto';
import { mailerReady, sendInviteMail } from '../services/mailer';
import { requireOwner, roleIn, Role } from './garageUsecase';
import {
  ALREADY_INVITED, ALREADY_MEMBER, canonicalEmail, EXPIRED_KEEP_MS, expired, GARAGE_FULL, INVITE_GONE, INVITE_TTL_MS, INVITES_UNAVAILABLE,
  MAX_MAILS_PER_DAY, MAX_MAILS_PER_USER_PER_DAY, MAX_PENDING, MAX_PEOPLE, SELF_INVITE, SEND_FAILED,
  TOO_MANY_PENDING, TOO_MANY_TODAY, wrongAccount
} from '../models/Invite';
import { SESSION_ENDED } from './authUsecase';
import { HttpError } from '../../utils/httpError';
import logger from '../../utils/logger';

const log = logger.child('MyGarageInvites');
const LINK_BASE = 'https://dctech.space/api/mygarage/invite/';

type Invite = typeof garageInvites.$inferSelect;

const emailOf = async (userId: string): Promise<string> => {
  const [u] = await mgDb.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) throw new HttpError(SESSION_ENDED, 401); // account deleted mid-request
  return u.email;
};

/**
 * Invite emails sent today (UTC day, so it resets at 00:00 UTC), in memory: a restart resets it, which only loosens it.
 * Protects the Gmail account GaragePulse shares from running out of its daily sending limit.
 */
let mailDay = '';
let mailsToday = 0;
const mailsByUser = new Map<string, number>();
export const resetMailCaps = (): void => {
  mailDay = '';
  mailsToday = 0;
  mailsByUser.clear();
};
/** Checks both caps and counts one email, with no await in between so two requests cannot both take the last slot. */
const reserveMail = (userId: string): void => {
  const day = new Date().toISOString().slice(0, 10);
  if (day !== mailDay) {
    mailDay = day;
    mailsToday = 0;
    mailsByUser.clear();
  }
  const mine = mailsByUser.get(userId) ?? 0;
  if (mailsToday >= MAX_MAILS_PER_DAY) throw new HttpError(INVITES_UNAVAILABLE, 503);
  if (mine >= MAX_MAILS_PER_USER_PER_DAY) throw new HttpError(TOO_MANY_TODAY, 429);
  mailsToday++;
  mailsByUser.set(userId, mine + 1);
};

/** Numbers and short codes only: the SMTP message text can carry the address. */
const smtpCause = (err: unknown): { code?: string; responseCode?: number } => {
  const e = err as { code?: unknown; responseCode?: unknown } | null;
  return {
    code: typeof e?.code === 'string' ? e.code.slice(0, 32) : undefined,
    responseCode: typeof e?.responseCode === 'number' ? e.responseCode : undefined
  };
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
  if (!owner) throw new HttpError(SESSION_ENDED, 401);
  const wanted = canonicalEmail(email);
  if (canonicalEmail(owner.email) === wanted) throw new HttpError(SELF_INVITE, 400);
  const members = await mgDb.select({ email: users.email, role: garageMembers.role })
    .from(garageMembers).innerJoin(users, eq(users.id, garageMembers.userId)).where(eq(garageMembers.garageId, garageId));
  if (members.some((m) => canonicalEmail(m.email) === wanted)) throw new HttpError(ALREADY_MEMBER, 409);
  if (members.filter((m) => m.role !== 'owner').length >= MAX_PEOPLE) throw new HttpError(GARAGE_FULL, 409);
  // Only unexpired invites count: an expired one is hidden from the owner, so it must not block a new one.
  const waiting = await mgDb.select({ email: garageInvites.email }).from(garageInvites)
    .where(and(eq(garageInvites.garageId, garageId), eq(garageInvites.status, 'pending'), gt(garageInvites.expiresAt, new Date())));
  if (waiting.some((w) => canonicalEmail(w.email) === wanted)) throw new HttpError(ALREADY_INVITED, 409);
  if (waiting.length >= MAX_PENDING) throw new HttpError(TOO_MANY_PENDING, 429);

  // Ended invites hold an email address: drop those that expired more than the grace period ago, in every garage.
  await mgDb.delete(garageInvites).where(lt(garageInvites.expiresAt, new Date(Date.now() - EXPIRED_KEEP_MS)));
  reserveMail(userId);
  const token = newRefreshToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [row] = await mgDb.insert(garageInvites).values({
    garageId, email, role, garageName, inviterName: owner.name ?? owner.email,
    tokenHash: hashToken(token), status: 'pending', expiresAt
  }).returning();
  try {
    await send(row, token);
  } catch (err) {
    await mgDb.delete(garageInvites).where(eq(garageInvites.id, row.id));
    log.error('Invite email failed', { inviteId: row.id, garageId, ...smtpCause(err) });
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
  reserveMail(userId);
  const token = newRefreshToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [updated] = await mgDb.update(garageInvites).set({ tokenHash: hashToken(token), expiresAt })
    .where(and(eq(garageInvites.id, inviteId), eq(garageInvites.status, 'pending'))).returning();
  if (!updated) throw new HttpError(INVITE_GONE, 404);
  try {
    await send(updated, token);
  } catch (err) {
    log.error('Invite email failed', { inviteId, garageId: row.garageId, ...smtpCause(err) });
    throw new HttpError(SEND_FAILED, 502);
  }
  return { expiresAt };
};

export const cancelInvite = async ({ userId, inviteId }: { userId: string; inviteId: string }): Promise<void> => {
  const row = await pendingById(inviteId);
  await requireOwner(userId, row.garageId);
  await mgDb.delete(garageInvites).where(and(eq(garageInvites.id, inviteId), eq(garageInvites.status, 'pending')));
};

export const listMyInvites = async ({ userId }: { userId: string }) => {
  const mine = canonicalEmail(await emailOf(userId));
  const rows = await mgDb.select({
    id: garageInvites.id, garageId: garageInvites.garageId, garageName: garageInvites.garageName, email: garageInvites.email,
    inviterName: garageInvites.inviterName, role: garageInvites.role, expiresAt: garageInvites.expiresAt
  }).from(garageInvites).where(and(eq(garageInvites.status, 'pending'), gt(garageInvites.expiresAt, new Date())));
  // ponytail: scans pending invites in memory (at most ~100 a day are sent, each lives 12 h); index a canonical column if that grows
  return rows.filter((r) => canonicalEmail(r.email) === mine).map(({ email: _email, ...r }) => r);
};

/** The invite is only for the account whose email it names; everyone else gets the masked address. */
const requireInvitee = async (userId: string, row: Invite): Promise<void> => {
  if (canonicalEmail(await emailOf(userId)) !== canonicalEmail(row.email)) throw new HttpError(wrongAccount(row.email), 403);
};

const accept = async (userId: string, row: Invite, tokenHash?: string): Promise<{ garageId: string; role: Role }> => {
  if (row.status !== 'pending') throw new HttpError(INVITE_GONE, 404);
  await requireInvitee(userId, row);
  if (Date.now() >= row.expiresAt.getTime()) throw new HttpError(expired(row.inviterName), 410);
  return mgDb.transaction(async (tx) => {
    // Via a link the claim also matches the presented token, so a resend landing in between kills the old one.
    const [claimed] = await tx.delete(garageInvites)
      .where(and(eq(garageInvites.id, row.id), eq(garageInvites.status, 'pending'), tokenHash ? eq(garageInvites.tokenHash, tokenHash) : undefined))
      .returning({ id: garageInvites.id });
    if (!claimed) throw new HttpError(INVITE_GONE, 404);
    if (!(await roleIn(userId, row.garageId, tx))) {
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(garageMembers)
        .where(and(eq(garageMembers.garageId, row.garageId), ne(garageMembers.role, 'owner')));
      if (n >= MAX_PEOPLE) throw new HttpError(GARAGE_FULL, 409); // rolls the claim back, the invite stays pending
    }
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
  return accept(userId, row, hashToken(token));
};

export const declineInvite = async ({ userId, inviteId }: { userId: string; inviteId: string }): Promise<void> => {
  const row = await pendingById(inviteId);
  await requireInvitee(userId, row);
  await mgDb.delete(garageInvites).where(and(eq(garageInvites.id, inviteId), eq(garageInvites.status, 'pending')));
};
