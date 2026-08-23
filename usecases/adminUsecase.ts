import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import os from 'os';
import Admin from '../models/Admin';
import User from '../models/User';
import Garage from '../models/Garage';
import Customer from '../models/Customer';
import Vehicle from '../models/Vehicle';
import JobCard from '../models/JobCard';
import Invoice from '../models/Invoice';
import Inventory from '../models/Inventory';
import ServiceReminder from '../models/ServiceReminder';
import logger from '../utils/logger';
import { resolveGarageLocale } from '../utils/locale';
import { HttpError } from '../utils/httpError';
import { AdminTokenPayload } from '../types/express';

const log = logger.child('AdminUsecase');

// A real bcrypt hash of a value nobody knows, compared against when the email
// does not exist so that login timing does not reveal which emails are admins.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3Uh1PJ8h1kQhVQF0Z0j4kQhVQF0Z0j4';

// ─── Credentials ───────────────────────────────────────────────────────────
// Admin identities live in the `admins` collection (see models/Admin.ts), not
// in environment variables. Only the token-signing secret is env-supplied.
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

  // `password` is `select: false` on the schema, so it has to be asked for.
  const admin = await Admin.findOne({ email: normalisedEmail }).select('+password');

  // Run the compare even when there is no such admin, against a dummy hash, so
  // an unknown email and a wrong password take the same time to answer.
  const passwordMatches = admin
    ? await admin.matchPassword(password || '')
    : await bcrypt.compare(password || '', DUMMY_HASH);

  if (!admin || !passwordMatches || !admin.isActive) {
    log.warn('Admin login failed', {
      email: normalisedEmail,
      reason: !admin ? 'no such admin' : !passwordMatches ? 'bad password' : 'deactivated'
    });
    throw new HttpError('Invalid admin credentials', 401);
  }

  // Not awaited into the response: a failed bookkeeping write should not fail
  // an otherwise valid login.
  Admin.updateOne({ _id: admin._id }, { $set: { lastLoginAt: new Date() } })
    .catch(err => log.warn('Could not record admin lastLoginAt', { error: (err as Error).message }));

  const token = jwt.sign(
    { isSuperAdmin: true, sub: admin._id.toString(), email: admin.email },
    secret,
    { expiresIn: TOKEN_TTL }
  );

  log.info('Admin login successful', { adminId: admin._id, email: admin.email });
  return {
    token,
    admin: { id: admin._id.toString(), name: admin.name, email: admin.email, role: 'super_admin' }
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

  const admin = await Admin.findById(decoded.sub).select('_id email isActive');
  if (!admin || !admin.isActive) {
    log.warn('Admin token rejected — account missing or deactivated', { adminId: decoded.sub });
    throw new HttpError('Invalid admin token', 401);
  }

  return decoded;
};

/**
 * Compile platform-wide stats: entity counts, revenue totals, job status breakdown,
 * most recent garages and users.
 */
export const getSystemStats = async () => {
  log.info('Compiling system-wide stats');
  const startTime = Date.now();

  const [garages, users, customers, vehicles, jobCards, invoices, inventory, reminders] = await Promise.all([
    Garage.countDocuments(),
    User.countDocuments(),
    Customer.countDocuments(),
    Vehicle.countDocuments(),
    JobCard.countDocuments(),
    Invoice.countDocuments(),
    Inventory.countDocuments(),
    ServiceReminder.countDocuments()
  ]);

  const [revenueAgg, jobsByStatusRaw, recentGarages, recentUsers] = await Promise.all([
    Invoice.aggregate([
      { $group: { _id: null, total: { $sum: '$grandTotal' }, paid: { $sum: '$amountPaid' } } }
    ]),
    JobCard.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]),
    Garage.find().sort({ createdAt: -1 }).limit(5).lean(),
    User.find().select('-password').sort({ createdAt: -1 }).limit(10).lean()
  ]);

  const queryTimeMs = Date.now() - startTime;
  if (queryTimeMs > 3000) {
    log.warn('Slow system stats compilation', { queryTimeMs });
  }

  log.info('System stats compiled', { garages, users, customers, vehicles, jobCards, queryTimeMs });

  return {
    counts: { garages, users, customers, vehicles, jobCards, invoices, inventory, reminders },
    revenue: revenueAgg[0] || { total: 0, paid: 0 },
    jobsByStatus: Object.fromEntries(jobsByStatusRaw.map((j: { _id: string; count: number }) => [j._id, j.count])),
    recentGarages,
    recentUsers,
    queryTimeMs
  };
};

/**
 * Return all garages enriched with per-garage user/customer/job-card/invoice counts
 * and total revenue.
 */
export const getAllGarages = async () => {
  log.info('Fetching all garages with enrichment');

  const garages = await Garage.find()
    .populate('owner', 'name email phone role')
    .sort({ createdAt: -1 })
    .lean();

  const enriched = await Promise.all(
    garages.map(async (g) => {
      const [userCount, customerCount, jobCardCount, invoiceCount, revAgg] = await Promise.all([
        User.countDocuments({ garage: g._id }),
        Customer.countDocuments({ garage: g._id }),
        JobCard.countDocuments({ garage: g._id }),
        Invoice.countDocuments({ garage: g._id }),
        Invoice.aggregate([
          { $match: { garage: g._id } },
          { $group: { _id: null, total: { $sum: '$grandTotal' } } }
        ])
      ]);

      return {
        ...g,
        // Each row's revenue is in ITS OWN currency — the admin list spans
        // every tenant, so there is no single currency to render it in.
        locale: resolveGarageLocale(g),
        _counts: { users: userCount, customers: customerCount, jobCards: jobCardCount, invoices: invoiceCount },
        _revenue: revAgg[0]?.total || 0
      };
    })
  );

  log.info('All garages fetched with enrichment', { count: enriched.length });
  return enriched;
};

/**
 * Delete a garage that has no owner.
 *
 * This exists specifically for the ownerless-garage bug in registerNewGarage
 * (fixed, but pre-existing/reproduced orphans still need cleanup): a garage
 * left behind when User.create() failed after Garage.create() had already
 * succeeded. Deliberately refuses to delete any garage that DOES have an
 * owner — that's a real, active garage with real data, and deleting it is a
 * much bigger, more deliberate action than this endpoint is for. Also wipes
 * anything scoped to the garage (should normally be nothing, since no owner
 * ever existed to create customers/vehicles/etc, but cheap to be thorough).
 */
export const deleteOrphanedGarage = async (garageId: string): Promise<{ deletedGarage: { id: string; name: string } }> => {
  const garage = await Garage.findById(garageId);
  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }
  if (garage.owner) {
    throw new HttpError('Refusing to delete a garage that has an owner. This action is only for ownerless (orphaned) garages.', 400);
  }

  await Promise.all([
    Customer.deleteMany({ garage: garageId }),
    Vehicle.deleteMany({ garage: garageId }),
    JobCard.deleteMany({ garage: garageId }),
    Invoice.deleteMany({ garage: garageId }),
    Inventory.deleteMany({ garage: garageId }),
    ServiceReminder.deleteMany({ garage: garageId }),
    User.deleteMany({ garage: garageId })
  ]);
  await Garage.findByIdAndDelete(garageId);

  log.warn('Admin deleted an orphaned (ownerless) garage', { garageId, name: garage.name });
  return { deletedGarage: { id: String(garage._id), name: garage.name } };
};

/**
 * Return all users (minus passwords) across all garages.
 */
export const getAllUsers = async () => {
  log.info('Fetching all platform users');
  const users = await User.find()
    .select('-password')
    .populate('garage', 'name')
    .sort({ createdAt: -1 })
    .lean();
  log.info('All platform users fetched', { count: users.length });
  return users;
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
 *   reference them (assignedMechanic, uploadedBy, invoice.createdBy, ...)
 *   are left as-is — they'll simply show as an unknown/removed staff member.
 * - Owner: an owner-less garage can't exist in this app's model, so this
 *   cascades — every garage (branch) they own, and everything scoped to
 *   those garages (customers, vehicles, job cards, invoices, inventory,
 *   reminders, and any staff assigned to those branches), is deleted too.
 *   Not wrapped in a transaction: this codebase's tests run against a
 *   standalone Mongo instance (no replica set), which doesn't support them.
 */
export const deleteUser = async (userId: string): Promise<DeleteUserResult> => {
  const user = await User.findById(userId);
  if (!user) {
    throw new HttpError('User not found', 404);
  }

  if (user.role !== 'owner') {
    await User.findByIdAndDelete(userId);
    log.warn('Admin deleted a staff user', { userId, email: user.email, role: user.role });
    return { deletedUser: { id: String(user._id), email: user.email, role: user.role } };
  }

  const garages = await Garage.find({ owner: userId }).select('_id');
  const garageIds = garages.map(g => g._id);

  const [customers, vehicles, jobCards, invoices, inventory, reminders, users] = await Promise.all([
    Customer.deleteMany({ garage: { $in: garageIds } }),
    Vehicle.deleteMany({ garage: { $in: garageIds } }),
    JobCard.deleteMany({ garage: { $in: garageIds } }),
    Invoice.deleteMany({ garage: { $in: garageIds } }),
    Inventory.deleteMany({ garage: { $in: garageIds } }),
    ServiceReminder.deleteMany({ garage: { $in: garageIds } }),
    // $or also matches the owner by _id in case their own `garage` field
    // somehow doesn't point at one of their own branches.
    User.deleteMany({ $or: [{ garage: { $in: garageIds } }, { _id: userId }] })
  ]);

  await Garage.deleteMany({ _id: { $in: garageIds } });

  log.warn('Admin cascade-deleted an owner and their garage(s)', {
    userId, email: user.email, garageCount: garageIds.length,
    counts: {
      users: users.deletedCount, customers: customers.deletedCount, vehicles: vehicles.deletedCount,
      jobCards: jobCards.deletedCount, invoices: invoices.deletedCount, inventory: inventory.deletedCount,
      reminders: reminders.deletedCount
    }
  });

  return {
    deletedUser: { id: String(user._id), email: user.email, role: user.role },
    cascadedGarages: garageIds.length,
    cascadedCounts: {
      users: users.deletedCount, customers: customers.deletedCount, vehicles: vehicles.deletedCount,
      jobCards: jobCards.deletedCount, invoices: invoices.deletedCount, inventory: inventory.deletedCount,
      reminders: reminders.deletedCount
    }
  };
};

/**
 * Return system health info: process memory, CPU, DB connection, platform metadata.
 */
export const getHealthInfo = () => {
  log.info('System health check requested');

  const memUsage = process.memoryUsage();
  const fmt = (b: number) => (b / 1024 / 1024).toFixed(2) + ' MB';
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];

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
      status: dbStates[mongoose.connection.readyState] || 'unknown',
      host:   mongoose.connection.host || 'N/A',
      name:   mongoose.connection.name || 'N/A'
    },
    environment: process.env.NODE_ENV || 'development'
  };

  log.info('Health info compiled', { dbStatus: health.database.status, env: health.environment });
  return health;
};
