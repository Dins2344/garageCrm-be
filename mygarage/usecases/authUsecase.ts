import jwt from 'jsonwebtoken';
import { and, eq, inArray } from 'drizzle-orm';
import { mgDb } from '../config/db';
import { getMyGarageEnv } from '../config/env';
import { users, refreshTokens, toApi } from '../models/User';
import { cloudFiles } from '../config/schema';
import { deleteObject, objectKey } from '../services/r2';
import { verifyGoogleIdToken } from '../services/google';
import { newDataKey, wrapKey, unwrapKey, newRefreshToken, hashToken } from '../services/crypto';
import { newId } from '../../utils/ids';
import { HttpError } from '../../utils/httpError';
import logger from '../../utils/logger';

const log = logger.child('MyGarageAuth');

export const SESSION_ENDED = 'Your session has ended. Sign in again.';
const REFRESH_DAYS = 90;
const R2_DELETE_CHUNK = 10;

export type Session = { accessToken: string; refreshToken: string; user: { id: string; email: string } };

const signAccess = (userId: string): string =>
  jwt.sign({ typ: 'mg-access' }, getMyGarageEnv().jwtSecret, { subject: userId, expiresIn: '1h', algorithm: 'HS256' });

const issueSession = async (tx: Pick<typeof mgDb, 'insert'>, user: { id: string; email: string }): Promise<Session> => {
  const refreshToken = newRefreshToken();
  await tx.insert(refreshTokens).values({
    tokenHash: hashToken(refreshToken),
    userId: user.id,
    expiresAt: new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000)
  });
  return { accessToken: signAccess(user.id), refreshToken, user: { id: user.id, email: user.email } };
};

export const signInWithGoogle = async ({ idToken }: { idToken: string }): Promise<Session> => {
  const env = getMyGarageEnv();
  const { sub, email } = await verifyGoogleIdToken(idToken, env.googleWebClientId);
  // A second device signing in at the same moment must not fail on the unique googleSub.
  await mgDb.insert(users)
    .values({ id: newId(), googleSub: sub, email, wrappedKey: wrapKey(newDataKey(), env.masterKey) })
    .onConflictDoNothing({ target: users.googleSub });
  let [user] = await mgDb.select().from(users).where(eq(users.googleSub, sub)).limit(1);
  if (user.email !== email) {
    [user] = await mgDb.update(users).set({ email }).where(eq(users.id, user.id)).returning();
  }
  const session = await issueSession(mgDb, user);
  log.info('Signed in', { userId: user.id });
  return session;
};

export const refreshSession = async ({ refreshToken }: { refreshToken: string }): Promise<Session> =>
  mgDb.transaction(async (tx) => {
    const [row] = await tx.delete(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(refreshToken))).returning();
    if (!row || row.expiresAt.getTime() <= Date.now()) throw new HttpError(SESSION_ENDED, 401);
    const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user) throw new HttpError(SESSION_ENDED, 401);
    return issueSession(tx, user);
  });

export const signOut = async ({ refreshToken }: { refreshToken: string }): Promise<void> => {
  await mgDb.delete(refreshTokens).where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
};

/** Resolves an access token to its user id, or null for any problem. */
export const userIdFromAccessToken = async (token: string): Promise<string | null> => {
  let sub: string;
  try {
    const payload = jwt.verify(token, getMyGarageEnv().jwtSecret, { algorithms: ['HS256'] });
    if (typeof payload === 'string' || payload.typ !== 'mg-access' || !payload.sub) return null;
    sub = payload.sub;
  } catch {
    return null;
  }
  // Outside the try: a database failure must surface as 503, not as a signed-out user.
  const [user] = await mgDb.select({ id: users.id }).from(users).where(eq(users.id, sub)).limit(1);
  return user?.id ?? null;
};

const loadUser = async (userId: string) => {
  const [user] = await mgDb.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw new HttpError(SESSION_ENDED, 401);
  return user;
};

export const getMe = async ({ userId }: { userId: string }) => toApi(await loadUser(userId));

export const getDataKey = async ({ userId }: { userId: string }): Promise<string> =>
  unwrapKey((await loadUser(userId)).wrappedKey, getMyGarageEnv().masterKey).toString('base64');

/** Removes every R2 object first, then the user; cascades take the rest. A failure leaves the user in place so a retry finishes the job. */
export const deleteAccount = async ({ userId }: { userId: string }): Promise<void> => {
  const files = await mgDb.select({ fileId: cloudFiles.fileId }).from(cloudFiles).where(eq(cloudFiles.userId, userId));
  for (let i = 0; i < files.length; i += R2_DELETE_CHUNK) {
    const chunk = files.slice(i, i + R2_DELETE_CHUNK);
    const results = await Promise.allSettled(chunk.map(({ fileId }) => deleteObject(objectKey(userId, fileId))));
    const gone = chunk.filter((_, n) => results[n].status === 'fulfilled').map((f) => f.fileId);
    if (gone.length) await mgDb.delete(cloudFiles).where(and(eq(cloudFiles.userId, userId), inArray(cloudFiles.fileId, gone)));
    if (gone.length < chunk.length) {
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      log.error('Account deletion stopped at a file', { userId, files: files.length, errorName: (failed?.reason as Error | undefined)?.name });
      throw new HttpError('Could not delete your files. Try again.', 502);
    }
  }
  await mgDb.delete(users).where(eq(users.id, userId));
  log.info('Account deleted', { userId, files: files.length });
};
