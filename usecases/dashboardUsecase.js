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
    upcomingReminders
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
      .lean()
  ]);

  const queryTime = Date.now() - startTime;
  if (queryTime > 2000) {
    log.warn('Slow stats compilation', { garageId, queryTimeMs: queryTime });
  }

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
    lowStockItems,
    recentJobCards,
    recentInvoices,
    upcomingReminders: upcomingReminders.map(r => ({
      ...r,
      isOverdue: new Date(r.nextServiceDate) < new Date()
    })),
    queryTimeMs: queryTime
  };
};
