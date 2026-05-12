const express = require('express');
const router = express.Router();
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

// ─── Super-Admin credentials (env-based) ───
const ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'superadmin@garageflow.com';
const ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'GarageFlow@Admin2026';
const ADMIN_SECRET = process.env.SUPER_ADMIN_SECRET || (process.env.JWT_SECRET + '_admin');

// ─── Admin auth middleware ───
function adminAuth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'No admin token' });
  try {
    const decoded = jwt.verify(token, ADMIN_SECRET);
    if (!decoded.isSuperAdmin) throw new Error();
    req.admin = decoded;
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid admin token' });
  }
}

// ─── Login ───
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    const token = jwt.sign({ isSuperAdmin: true, email }, ADMIN_SECRET, { expiresIn: '4h' });
    return res.json({ success: true, token, data: { email, role: 'super_admin' } });
  }
  return res.status(401).json({ success: false, message: 'Invalid admin credentials' });
});

// ─── Verify token ───
router.get('/verify', adminAuth, (req, res) => {
  res.json({ success: true, data: req.admin });
});

// ─── Overview Stats ───
router.get('/stats', adminAuth, async (req, res) => {
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

  const revenueAgg = await Invoice.aggregate([
    { $group: { _id: null, total: { $sum: '$grandTotal' }, paid: { $sum: '$amountPaid' } } }
  ]);

  const jobsByStatus = await JobCard.aggregate([
    { $group: { _id: '$status', count: { $sum: 1 } } }
  ]);

  const recentGarages = await Garage.find().sort({ createdAt: -1 }).limit(5).lean();
  const recentUsers = await User.find().select('-password').sort({ createdAt: -1 }).limit(10).lean();

  res.json({
    success: true,
    data: {
      counts: { garages, users, customers, vehicles, jobCards, invoices, inventory, reminders },
      revenue: revenueAgg[0] || { total: 0, paid: 0 },
      jobsByStatus: Object.fromEntries(jobsByStatus.map(j => [j._id, j.count])),
      recentGarages,
      recentUsers
    }
  });
});

// ─── All Garages ───
router.get('/garages', adminAuth, async (req, res) => {
  const garages = await Garage.find().populate('owner', 'name email phone role').sort({ createdAt: -1 }).lean();

  // Enrich with counts per garage
  const enriched = await Promise.all(garages.map(async (g) => {
    const [userCount, customerCount, jobCardCount, invoiceCount] = await Promise.all([
      User.countDocuments({ garage: g._id }),
      Customer.countDocuments({ garage: g._id }),
      JobCard.countDocuments({ garage: g._id }),
      Invoice.countDocuments({ garage: g._id })
    ]);
    const rev = await Invoice.aggregate([
      { $match: { garage: g._id } },
      { $group: { _id: null, total: { $sum: '$grandTotal' } } }
    ]);
    return { ...g, _counts: { users: userCount, customers: customerCount, jobCards: jobCardCount, invoices: invoiceCount }, _revenue: rev[0]?.total || 0 };
  }));

  res.json({ success: true, data: enriched });
});

// ─── All Users ───
router.get('/users', adminAuth, async (req, res) => {
  const users = await User.find().select('-password').populate('garage', 'name').sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: users });
});

// ─── System Health ───
router.get('/health', adminAuth, async (req, res) => {
  const memUsage = process.memoryUsage();
  const fmt = (b) => (b / 1024 / 1024).toFixed(2) + ' MB';
  const dbStates = ['disconnected', 'connected', 'connecting', 'disconnecting'];

  res.json({
    success: true,
    data: {
      uptime: { process: Math.floor(process.uptime()) + 's', system: Math.floor(os.uptime()) + 's' },
      memory: { heapUsed: fmt(memUsage.heapUsed), heapTotal: fmt(memUsage.heapTotal), rss: fmt(memUsage.rss), systemTotal: fmt(os.totalmem()), systemFree: fmt(os.freemem()) },
      cpu: { cores: os.cpus().length, model: os.cpus()[0]?.model, loadAvg: os.loadavg().map(l => l.toFixed(2)) },
      platform: { node: process.version, os: `${os.type()} ${os.release()}`, arch: os.arch() },
      database: { status: dbStates[mongoose.connection.readyState] || 'unknown', host: mongoose.connection.host || 'N/A', name: mongoose.connection.name || 'N/A' },
      environment: process.env.NODE_ENV || 'development'
    }
  });
});

module.exports = router;
