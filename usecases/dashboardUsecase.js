const JobCard = require('../models/JobCard');
const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const Vehicle = require('../models/Vehicle');
const Inventory = require('../models/Inventory');
const ServiceReminder = require('../models/ServiceReminder');
const logger = require('../utils/logger');
const log = logger.child('DashboardUsecase');

exports.compileStats = async ({ garageId }) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

  const startTime = Date.now();

  const [
    totalCustomers,
    totalVehicles,
    activeJobCards,
    todayJobCards,
    pendingEstimations,
    inProgressJobs,
    readyForPickup,
    todayRevenue,
    monthRevenue,
    unpaidInvoices,
    lowStockItems,
    recentJobCards,
    recentInvoices,
    upcomingReminders,
    staffAchievement,
    weeklyRevenue,
    jobStatusCounts
  ] = await Promise.all([
    Customer.countDocuments({ garage: garageId }),
    Vehicle.countDocuments({ garage: garageId }),
    JobCard.countDocuments({ garage: garageId, status: { $nin: ['delivered', 'cancelled'] } }),
    JobCard.countDocuments({ garage: garageId, createdAt: { $gte: today, $lt: tomorrow } }),
    JobCard.countDocuments({ garage: garageId, status: { $in: ['new', 'estimation_sent'] } }),
    JobCard.countDocuments({ garage: garageId, status: 'in_progress' }),
    JobCard.countDocuments({ garage: garageId, status: 'ready_for_pickup' }),
    Invoice.aggregate([
      { $match: { garage: garageId, paymentStatus: 'paid', paidAt: { $gte: today, $lt: tomorrow } } },
      { $group: { _id: null, total: { $sum: '$grandTotal' } } }
    ]),
    Invoice.aggregate([
      { $match: { garage: garageId, paymentStatus: 'paid', paidAt: { $gte: monthStart, $lt: tomorrow } } },
      { $group: { _id: null, total: { $sum: '$grandTotal' } } }
    ]),
    Invoice.aggregate([
      { $match: { garage: garageId, paymentStatus: { $in: ['unpaid', 'partial'] } } },
      { $group: { _id: null, total: { $sum: { $subtract: ['$grandTotal', '$amountPaid'] } }, count: { $sum: 1 } } }
    ]),
    Inventory.find({
      garage: garageId,
      isActive: true,
      $expr: { $lte: ['$quantity', '$threshold'] }
    }).select('partName quantity threshold category').sort('quantity').limit(10).lean(),
    JobCard.find({ garage: garageId })
      .populate('vehicle', 'licensePlate make model')
      .populate('customer', 'name phone')
      .populate('assignedMechanic', 'name')
      .select('jobCardNumber status createdAt vehicle customer assignedMechanic')
      .sort('-createdAt')
      .limit(5)
      .lean(),
    Invoice.find({ garage: garageId })
      .populate('customer', 'name')
      .populate('vehicle', 'licensePlate')
      .select('invoiceNumber grandTotal paymentStatus createdAt customer vehicle')
      .sort('-createdAt')
      .limit(5)
      .lean(),
    ServiceReminder.find({
      garage: garageId,
      status: 'pending',
      nextServiceDate: { $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
    })
      .populate('vehicle', 'licensePlate make model')
      .populate('customer', 'name phone')
      .sort('nextServiceDate')
      .limit(10)
      .lean(),
    JobCard.aggregate([
      { $match: { 
          garage: garageId, 
          status: { $nin: ['cancelled'] }, 
          createdAt: { $gte: monthStart } 
      }},
      { $group: {
          _id: "$assignedMechanic",
          totalLaborValue: { $sum: { $sum: { $map: { 
              input: "$estimation.labor", 
              as: "l", 
              in: { $multiply: ["$$l.hours", "$$l.ratePerHour"] } 
          }}}},
          jobCount: { $sum: 1 }
      }},
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'staff'
        }
      },
      { $unwind: { path: "$staff", preserveNullAndEmptyArrays: true } },
      { $project: {
          staffName: { $ifNull: ["$staff.name", "Unassigned"] },
          role: { $ifNull: ["$staff.role", "mechanic"] },
          totalLabor: "$totalLaborValue",
          jobCount: "$jobCount"
      }},
      { $sort: { totalLabor: -1 } }
    ]),
    // Weekly revenue — last 7 days grouped by day
    Invoice.aggregate([
      { $match: {
          garage: garageId,
          paymentStatus: 'paid',
          paidAt: { $gte: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) }
      }},
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$paidAt' } },
          revenue: { $sum: '$grandTotal' },
          count: { $sum: 1 }
      }},
      { $sort: { _id: 1 } }
    ]),
    // Job status breakdown
    JobCard.aggregate([
      { $match: { garage: garageId } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])
  ]);

  const queryTime = Date.now() - startTime;
  if (queryTime > 2000) {
    log.warn('Slow stats compilation', { garageId, queryTimeMs: queryTime });
  }

  // Build a full 7-day revenue array (fill missing days with 0)
  const revenueMap = {};
  weeklyRevenue.forEach(d => { revenueMap[d._id] = d.revenue; });
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
    const key = d.toISOString().split('T')[0];
    return {
      date: key,
      label: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
      revenue: revenueMap[key] || 0
    };
  });

  // Build job status breakdown map
  const statusBreakdown = {};
  jobStatusCounts.forEach(s => { statusBreakdown[s._id] = s.count; });

  return {
    overview: {
      totalCustomers,
      totalVehicles,
      activeJobCards,
      todayJobCards,
      pendingEstimations,
      inProgressJobs,
      readyForPickup
    },
    revenue: {
      today: todayRevenue[0]?.total || 0,
      month: monthRevenue[0]?.total || 0
    },
    unpaid: {
      total: unpaidInvoices[0]?.total || 0,
      count: unpaidInvoices[0]?.count || 0
    },
    weeklyRevenue: last7Days,
    jobStatusBreakdown: statusBreakdown,
    lowStockItems,
    recentJobCards,
    recentInvoices,
    upcomingReminders: upcomingReminders.map(r => ({
      ...r,
      isOverdue: new Date(r.nextServiceDate) < new Date()
    })),
    staffAchievement,
    queryTimeMs: queryTime
  };
};

// ── Chart data for arbitrary date ranges ──────────────────────────────────────
exports.getChartData = async ({ garageId, startDate, endDate, groupBy }) => {
  // MongoDB date format string per groupBy mode
  const fmtMap = { day: '%Y-%m-%d', week: '%Y-%U', month: '%Y-%m' };
  const dateFormat = fmtMap[groupBy] || '%Y-%m-%d';

  const [revenueRaw, jobStatusRaw] = await Promise.all([
    // Revenue grouped by period
    Invoice.aggregate([
      {
        $match: {
          garage: garageId,
          paymentStatus: 'paid',
          paidAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$paidAt' } },
          revenue: { $sum: '$grandTotal' },
          invoiceCount: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]),

    // Job status breakdown within the date range (by createdAt)
    JobCard.aggregate([
      {
        $match: {
          garage: garageId,
          createdAt: { $gte: startDate, $lte: endDate }
        }
      },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ])
  ]);

  // Fill all periods in the range with 0 for missing days/weeks/months
  const revenueMap = {};
  revenueRaw.forEach(d => { revenueMap[d._id] = { revenue: d.revenue, count: d.invoiceCount }; });

  const periods = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);

  while (cursor <= end) {
    let key;
    let label;

    if (groupBy === 'month') {
      key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`;
      label = cursor.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
      cursor.setMonth(cursor.getMonth() + 1);
    } else if (groupBy === 'week') {
      // ISO week number
      const jan1 = new Date(cursor.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((cursor - jan1) / 86400000 + jan1.getDay() + 1) / 7);
      key = `${cursor.getFullYear()}-${String(weekNum).padStart(2, '0')}`;
      label = `W${weekNum}`;
      cursor.setDate(cursor.getDate() + 7);
    } else {
      key = cursor.toISOString().split('T')[0];
      label = cursor.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
      cursor.setDate(cursor.getDate() + 1);
    }

    if (!periods.find(p => p.key === key)) {
      periods.push({
        key,
        label,
        revenue: revenueMap[key]?.revenue || 0,
        invoiceCount: revenueMap[key]?.count || 0
      });
    }
  }

  // Job status map
  const jobStatusBreakdown = {};
  jobStatusRaw.forEach(s => { jobStatusBreakdown[s._id] = s.count; });

  return { revenueTrend: periods, jobStatusBreakdown };
};

