import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import os from 'os';
import User from '../models/User';
import Garage from '../models/Garage';
import Customer from '../models/Customer';
import Vehicle from '../models/Vehicle';
import JobCard from '../models/JobCard';
import Invoice from '../models/Invoice';
import Inventory from '../models/Inventory';
import ServiceReminder from '../models/ServiceReminder';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { AdminTokenPayload } from '../types/express';

const log = logger.child('AdminUsecase');

// ─── Credentials (env-based) ───────────────────────────────────────────────
const ADMIN_EMAIL    = process.env.SUPER_ADMIN_EMAIL    || 'superadmin@garagepulse.com';
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'GaragePulse@Admin2026';
const ADMIN_SECRET   = process.env.SUPER_ADMIN_SECRET   || (process.env.JWT_SECRET + '_admin');

interface AdminLoginInput {
  email: string;
  password: string;
}

/**
 * Validate admin credentials and issue a short-lived JWT.
 * Returns the signed token and the admin payload on success.
 * Throws 401 if credentials are invalid.
 */
export const adminLogin = ({ email, password }: AdminLoginInput): { token: string; admin: { email: string; role: string } } => {
  log.info('Admin login attempt', { email });

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    log.warn('Admin login failed — invalid credentials', { email });
    throw new HttpError('Invalid admin credentials', 401);
  }

  const token = jwt.sign({ isSuperAdmin: true, email }, ADMIN_SECRET, { expiresIn: '4h' });
  log.info('Admin login successful', { email });
  return { token, admin: { email, role: 'super_admin' } };
};

/**
 * Verify an admin JWT.
 * Returns the decoded payload or throws 401.
 */
export const verifyAdminToken = (token: string): AdminTokenPayload => {
  try {
    const decoded = jwt.verify(token, ADMIN_SECRET) as AdminTokenPayload;
    if (!decoded.isSuperAdmin) throw new Error('Not a super-admin token');
    return decoded;
  } catch (err) {
    log.warn('Admin token verification failed', { error: (err as Error).message });
    throw new HttpError('Invalid admin token', 401);
  }
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
        _counts: { users: userCount, customers: customerCount, jobCards: jobCardCount, invoices: invoiceCount },
        _revenue: revAgg[0]?.total || 0
      };
    })
  );

  log.info('All garages fetched with enrichment', { count: enriched.length });
  return enriched;
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
