const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const os = require('os');
const User = require('../models/User');
const Garage = require('../models/Garage');
const Customer = require('../models/Customer');
const Vehicle = require('../models/Vehicle');
const JobCard = require('../models/JobCard');
const Invoice = require('../models/Invoice');
const Inventory = require('../models/Inventory');
const ServiceReminder = require('../models/ServiceReminder');
const logger = require('../utils/logger');
const log = logger.child('AdminUsecase');

// ─── Credentials (env-based) ───────────────────────────────────────────────
const ADMIN_EMAIL    = process.env.SUPER_ADMIN_EMAIL    || 'superadmin@garageflow.com';
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'GarageFlow@Admin2026';
const ADMIN_SECRET   = process.env.SUPER_ADMIN_SECRET   || (process.env.JWT_SECRET + '_admin');

/**
 * Validate admin credentials and issue a short-lived JWT.
 * Returns the signed token and the admin payload on success.
 * Throws 401 if credentials are invalid.
 */
exports.adminLogin = ({ email, password }) => {
  log.info('Admin login attempt', { email });

  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    log.warn('Admin login failed — invalid credentials', { email });
    const err = new Error('Invalid admin credentials');
    err.statusCode = 401;
    throw err;
  }

  const token = jwt.sign({ isSuperAdmin: true, email }, ADMIN_SECRET, { expiresIn: '4h' });
  log.info('Admin login successful', { email });
  return { token, admin: { email, role: 'super_admin' } };
};

/**
 * Verify an admin JWT.
 * Returns the decoded payload or throws 401.
 */
exports.verifyAdminToken = (token) => {
  try {
    const decoded = jwt.verify(token, ADMIN_SECRET);
    if (!decoded.isSuperAdmin) throw new Error('Not a super-admin token');
    return decoded;
  } catch (err) {
    log.warn('Admin token verification failed', { error: err.message });
    const error = new Error('Invalid admin token');
    error.statusCode = 401;
    throw error;
  }
};

/**
 * Compile platform-wide stats: entity counts, revenue totals, job status breakdown,
 * most recent garages and users.
 */
exports.getSystemStats = async () => {
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
    jobsByStatus: Object.fromEntries(jobsByStatusRaw.map(j => [j._id, j.count])),
    recentGarages,
    recentUsers,
    queryTimeMs
  };
};

/**
 * Return all garages enriched with per-garage user/customer/job-card/invoice counts
 * and total revenue.
 */
exports.getAllGarages = async () => {
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
exports.getAllUsers = async () => {
  log.info('Fetching all platform users');
  const users = await User.find()
    .select('-password')
    .populate('garage', 'name')
    .sort({ createdAt: -1 })
    .lean();
  log.info('All platform users fetched', { count: users.length });
  return users;
};

/**
 * Return system health info: process memory, CPU, DB connection, platform metadata.
 */
exports.getHealthInfo = () => {
  log.info('System health check requested');

  const memUsage = process.memoryUsage();
  const fmt = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';
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
