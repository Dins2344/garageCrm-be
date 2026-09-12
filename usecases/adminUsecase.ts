import jwt from 'jsonwebtoken';
import os from 'os';
import { count, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { db, pingDb } from '../config/db';
import { admins } from '../models/Admin';
import { users, USER_PUBLIC_COLUMNS, userToApi } from '../models/User';
import { garages, garageToApi } from '../models/Garage';
import { customers } from '../models/Customer';
import { vehicles } from '../models/Vehicle';
import { jobCards } from '../models/JobCard';
import { invoices } from '../models/Invoice';
import { inventory } from '../models/Inventory';
import { serviceReminders } from '../models/ServiceReminder';
import { comparePassword } from '../utils/password';
import logger from '../utils/logger';
import { resolveGarageLocale } from '../utils/locale';
import { HttpError } from '../utils/httpError';
import { AdminTokenPayload } from '../types/express';

const log = logger.child('AdminUsecase');

// A real bcrypt hash of a value nobody knows, compared against when the email
// does not exist so that login timing does not reveal which emails are admins.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3Uh1PJ8h1kQhVQF0Z0j4kQhVQF0Z0j4';

// ─── Credentials ───────────────────────────────────────────────────────────
// Admin identities live in the `admins` table (see models/Admin.ts), not in
// environment variables. Only the token-signing secret is env-supplied.
//
// Read lazily rather than at module load: `app.ts` is imported by every test
// and by `scripts/`, and throwing during import would take all of them down
// instead of just the admin login path.
const adminSecret = (): string => {
  const secret = process.env.SUPER_ADMIN_SECRET;
  if (!secret) {
    // No fallback on purpose. The previous default was `JWT_SECRET + '_admin'`,
    // which silently became the literal string 'undefined_admin' whenever
    // JWT_SECRET was unset — a guessable signing key for platform-wide access.
    log.error('SUPER_ADMIN_SECRET is not set — admin authentication is disabled');
    throw new HttpError('Admin authentication is not configured', 500);
  }
  return secret;
};

const TOKEN_TTL = '4h';

interface AdminLoginInput {
  email: string;
  password: string;
}

/**
 * Validate admin credentials against the database and issue a short-lived JWT.
 * Throws 401 if the email is unknown, the password is wrong, or the account is
 * deactivated — all three produce the same message so the response cannot be
 * used to enumerate admin accounts.
 */
export const adminLogin = async ({ email, password }: AdminLoginInput): Promise<{ token: string; admin: { id: string; name: string; email: string; role: string } }> => {
  const normalisedEmail = String(email || '').toLowerCase().trim();
  log.info('Admin login attempt', { email: normalisedEmail });

  const secret = adminSecret();

  const admin = await db.query.admins.findFirst({ where: eq(admins.email, normalisedEmail) });

  // Run the compare even when there is no such admin, against a dummy hash, so
  // an unknown email and a wrong password take the same time to answer.
  const passwordMatches = await comparePassword(password || '', admin ? admin.password : DUMMY_HASH);

  if (!admin || !passwordMatches || !admin.isActive) {
    log.warn('Admin login failed', {
      email: normalisedEmail,
      reason: !admin ? 'no such admin' : !passwordMatches ? 'bad password' : 'deactivated'
    });
    throw new HttpError('Invalid admin credentials', 401);
  }

  // Not awaited into the response: a failed bookkeeping write should not fail
  // an otherwise valid login.
  db.update(admins).set({ lastLoginAt: new Date() }).where(eq(admins._id, admin._id))
    .catch(err => log.warn('Could not record admin lastLoginAt', { error: (err as Error).message }));

  const token = jwt.sign(
    { isSuperAdmin: true, sub: admin._id, email: admin.email },
    secret,
    { expiresIn: TOKEN_TTL }
  );

  log.info('Admin login successful', { adminId: admin._id, email: admin.email });
  return {
    token,
    admin: { id: admin._id, name: admin.name, email: admin.email, role: 'super_admin' }
  };
};

/**
 * Verify an admin JWT and confirm the account behind it is still valid.
 *
 * The database read is deliberate. A signature check alone would keep a
 * deleted or deactivated admin working for the rest of the token's 4 hours;
 * re-reading the record makes deactivation take effect on the next request.
 * Admin traffic is a handful of requests per session, so the cost is nil.
 */
export const verifyAdminToken = async (token: string): Promise<AdminTokenPayload> => {
  const secret = adminSecret();

  let decoded: AdminTokenPayload;
  try {
    decoded = jwt.verify(token, secret) as AdminTokenPayload;
  } catch (err) {
    log.warn('Admin token verification failed', { error: (err as Error).message });
    throw new HttpError('Invalid admin token', 401);
  }

  if (!decoded.isSuperAdmin || !decoded.sub) {
    log.warn('Admin token rejected — not a super-admin token');
    throw new HttpError('Invalid admin token', 401);
  }

  const admin = await db.query.admins.findFirst({
    columns: { _id: true, email: true, isActive: true },
    where: eq(admins._id, decoded.sub)
  });
  if (!admin || !admin.isActive) {
    log.warn('Admin token rejected — account missing or deactivated', { adminId: decoded.sub });
    throw new HttpError('Invalid admin token', 401);
  }

  return decoded;
};

const countAll = async (table: PgTable): Promise<number> => {
  const [{ value }] = await db.select({ value: count() }).from(table);
  return value;
};

/**
 * Compile platform-wide stats: entity counts, revenue totals, job status breakdown,
 * most recent garages and users.
 */
export const getSystemStats = async () => {
  log.info('Compiling system-wide stats');
  const startTime = Date.now();

  const [garageCount, userCount, customerCount, vehicleCount, jobCardCount, invoiceCount, inventoryCount, reminderCount] = await Promise.all([
    countAll(garages),
    countAll(users),
    countAll(customers),
    countAll(vehicles),
    countAll(jobCards),
    countAll(invoices),
    countAll(inventory),
    countAll(serviceReminders)
  ]);

  const [[revenueAgg], jobsByStatusRaw, recentGarages, recentUsers] = await Promise.all([
    db.select({ total: sum(invoices.grandTotal), paid: sum(invoices.amountPaid) }).from(invoices),
    db.select({ status: jobCards.status, count: count() }).from(jobCards).groupBy(jobCards.status),
    db.query.garages.findMany({ orderBy: [desc(garages.createdAt)], limit: 5 }),
    db.query.users.findMany({ columns: USER_PUBLIC_COLUMNS, orderBy: [desc(users.createdAt)], limit: 10 })
  ]);

  const queryTimeMs = Date.now() - startTime;
  if (queryTimeMs > 3000) {
    log.warn('Slow system stats compilation', { queryTimeMs });
  }

  log.info('System stats compiled', {
    garages: garageCount, users: userCount, customers: customerCount, vehicles: vehicleCount, jobCards: jobCardCount, queryTimeMs
  });

  return {
    counts: {
      garages: garageCount, users: userCount, customers: customerCount, vehicles: vehicleCount,
      jobCards: jobCardCount, invoices: invoiceCount, inventory: inventoryCount, reminders: reminderCount
    },
    revenue: { total: Number(revenueAgg?.total) || 0, paid: Number(revenueAgg?.paid) || 0 },
    jobsByStatus: Object.fromEntries(jobsByStatusRaw.map(j => [j.status, j.count])),
    recentGarages: recentGarages.map(garageToApi),
    recentUsers: recentUsers.map(userToApi),
    queryTimeMs
  };
};

/**
 * Return all garages enriched with per-garage user/customer/job-card/invoice counts
 * and total revenue.
 */
export const getAllGarages = async () => {
  log.info('Fetching all garages with enrichment');

  const rows = await db.query.garages.findMany({
    with: { owner: { columns: { _id: true, name: true, email: true, phone: true, role: true } } },
    orderBy: [desc(garages.createdAt)]
  });

  const enriched = await Promise.all(
    rows.map(async (g) => {
      const [[{ userCount }], [{ customerCount }], [{ jobCardCount }], [{ invoiceCount, revenue }]] = await Promise.all([
        db.select({ userCount: count() }).from(users).where(eq(users.garageId, g._id)),
        db.select({ customerCount: count() }).from(customers).where(eq(customers.garageId, g._id)),
        db.select({ jobCardCount: count() }).from(jobCards).where(eq(jobCards.garageId, g._id)),
        db.select({ invoiceCount: count(), revenue: sum(invoices.grandTotal) }).from(invoices).where(eq(invoices.garageId, g._id))
      ]);

      return {
        ...garageToApi(g),
        // Each row's revenue is in ITS OWN currency — the admin list spans
        // every tenant, so there is no single currency to render it in.
        locale: resolveGarageLocale(g),
        _counts: { users: userCount, customers: customerCount, jobCards: jobCardCount, invoices: invoiceCount },
        _revenue: Number(revenue) || 0
      };
    })
  );

  log.info('All garages fetched with enrichment', { count: enriched.length });
  return enriched;
};

/**
 * Delete a garage that has no owner.
 *
 * Registration now creates the garage and its owner in one transaction, so
 * new orphans cannot appear; this remains for any that pre-date that, and as
 * the cleanup path when an owner's row is removed by other means (the
 * `owner_id` foreign key nulls the garage rather than deleting it).
 * Deliberately refuses to delete any garage that DOES have an owner — that's
 * a real, active garage with real data, and deleting it is a much bigger,
 * more deliberate action than this endpoint is for. Everything scoped to the
 * garage cascades from `garage_id`.
 */
export const deleteOrphanedGarage = async (garageId: string): Promise<{ deletedGarage: { id: string; name: string } }> => {
  const garage = await db.query.garages.findFirst({ where: eq(garages._id, garageId) });
  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }
  if (garage.ownerId) {
    throw new HttpError('Refusing to delete a garage that has an owner. This action is only for ownerless (orphaned) garages.', 400);
  }

  await db.delete(garages).where(eq(garages._id, garageId));

  log.warn('Admin deleted an orphaned (ownerless) garage', { garageId, name: garage.name });
  return { deletedGarage: { id: garage._id, name: garage.name } };
};

/**
 * Return all users (minus passwords) across all garages.
 */
export const getAllUsers = async () => {
  log.info('Fetching all platform users');
  const rows = await db.query.users.findMany({
    columns: USER_PUBLIC_COLUMNS,
    with: { garage: { columns: { _id: true, name: true } } },
    orderBy: [desc(users.createdAt)]
  });
  log.info('All platform users fetched', { count: rows.length });
  return rows.map(userToApi);
};

export interface DeleteUserResult {
  deletedUser: { id: string; email: string; role: string };
  cascadedGarages?: number;
  cascadedCounts?: {
    users: number;
    customers: number;
    vehicles: number;
    jobCards: number;
    invoices: number;
    inventory: number;
    reminders: number;
  };
}

/**
 * Delete a platform user.
 *
 * - Staff (non-owner): deletes just that user record. Old records that
 *   reference them (assignedMechanic, invoice.createdBy, ...) are nulled by
 *   the foreign keys — they'll simply show as an unknown/removed staff member.
 * - Owner: an owner-less garage can't exist in this app's model, so this
 *   cascades — every garage (branch) they own, and everything scoped to
 *   those garages (customers, vehicles, job cards, invoices, inventory,
 *   reminders, and any staff assigned to those branches), is deleted too.
 *   The counts are taken first so the response can report what went; the
 *   deletion itself is one transaction.
 */
export const deleteUser = async (userId: string): Promise<DeleteUserResult> => {
  const user = await db.query.users.findFirst({ columns: USER_PUBLIC_COLUMNS, where: eq(users._id, userId) });
  if (!user) {
    throw new HttpError('User not found', 404);
  }

  if (user.role !== 'owner') {
    await db.delete(users).where(eq(users._id, userId));
    log.warn('Admin deleted a staff user', { userId, email: user.email, role: user.role });
    return { deletedUser: { id: user._id, email: user.email, role: user.role } };
  }

  const owned = await db.select({ _id: garages._id }).from(garages).where(eq(garages.ownerId, userId));
  const garageIds = owned.map(g => g._id);

  const scoped = async (table: typeof customers | typeof vehicles | typeof jobCards | typeof invoices | typeof inventory | typeof serviceReminders) => {
    if (garageIds.length === 0) return 0;
    const [{ value }] = await db.select({ value: count() }).from(table).where(inArray(table.garageId, garageIds));
    return value;
  };

  const [customerCount, vehicleCount, jobCardCount, invoiceCount, inventoryCount, reminderCount, [{ userCount }]] = await Promise.all([
    scoped(customers),
    scoped(vehicles),
    scoped(jobCards),
    scoped(invoices),
    scoped(inventory),
    scoped(serviceReminders),
    // Also counts the owner by _id in case their own `garage` field somehow
    // doesn't point at one of their own branches.
    db.select({ userCount: count() }).from(users).where(
      garageIds.length ? sql`${users.garageId} in ${garageIds} or ${users._id} = ${userId}` : eq(users._id, userId)
    )
  ]);

  await db.transaction(async tx => {
    if (garageIds.length) {
      // Staff and every tenant row cascade from the garages.
      await tx.delete(garages).where(inArray(garages._id, garageIds));
    }
    await tx.delete(users).where(eq(users._id, userId));
  });

  const counts = {
    users: userCount, customers: customerCount, vehicles: vehicleCount,
    jobCards: jobCardCount, invoices: invoiceCount, inventory: inventoryCount,
    reminders: reminderCount
  };

  log.warn('Admin cascade-deleted an owner and their garage(s)', {
    userId, email: user.email, garageCount: garageIds.length, counts
  });

  return {
    deletedUser: { id: user._id, email: user.email, role: user.role },
    cascadedGarages: garageIds.length,
    cascadedCounts: counts
  };
};

/**
 * Return system health info: process memory, CPU, DB connection, platform metadata.
 */
export const getHealthInfo = async () => {
  log.info('System health check requested');

  const memUsage = process.memoryUsage();
  const fmt = (b: number) => (b / 1024 / 1024).toFixed(2) + ' MB';
  const dbReachable = await pingDb();

  const health = {
    uptime: {
      process: Math.floor(process.uptime()) + 's',
      system:  Math.floor(os.uptime()) + 's'
    },
    memory: {
      heapUsed:    fmt(memUsage.heapUsed),
      heapTotal:   fmt(memUsage.heapTotal),
      rss:         fmt(memUsage.rss),
      systemTotal: fmt(os.totalmem()),
      systemFree:  fmt(os.freemem())
    },
    cpu: {
      cores:   os.cpus().length,
      model:   os.cpus()[0]?.model,
      loadAvg: os.loadavg().map(l => l.toFixed(2))
    },
    platform: {
      node: process.version,
      os:   `${os.type()} ${os.release()}`,
      arch: os.arch()
    },
    database: {
      status: dbReachable ? 'connected' : 'disconnected',
      engine: 'postgresql'
    },
    environment: process.env.NODE_ENV || 'development'
  };

  log.info('Health info compiled', { dbStatus: health.database.status, env: health.environment });
  return health;
};
