import { and, asc, count, desc, eq, gte, inArray, lt, lte, ne, sql, sum } from 'drizzle-orm';
import { db } from '../config/db';
import { jobCards, jobCardSummaryToApi } from '../models/JobCard';
import { invoices, invoiceToApi } from '../models/Invoice';
import { customers } from '../models/Customer';
import { vehicles } from '../models/Vehicle';
import { inventory } from '../models/Inventory';
import { serviceReminders, reminderToApi } from '../models/ServiceReminder';
import { garages } from '../models/Garage';
import { users } from '../models/User';
import { expenses } from '../models/Expense';
import { monthKey, monthRange, previousMonthKey } from '../utils/dates';
import { EXPENSE_CATEGORIES, ExpenseCategory } from '../types/domain';
import { HttpError } from '../utils/httpError';
import logger from '../utils/logger';
import { resolveGarageLocale } from '../utils/locale';
import { formatDate } from '../utils/format';

const log = logger.child('DashboardUsecase');

/**
 * Chart axis labels are baked server-side, so they must follow the garage's
 * locale rather than the server's.
 *
 * Deliberately formatted WITHOUT a timezone: the cursor dates below are built
 * from the server clock and paired with a `key` derived from the same date.
 * Shifting the label into another zone would let it name a different day than
 * its key, so the label follows the locale only.
 */
const resolveChartLocale = async (garageId: string) => {
  const garage = await db.query.garages.findFirst({
    columns: { country: true, settings: true },
    where: eq(garages._id, garageId)
  });
  return resolveGarageLocale(garage);
};

/** `count(*)` of one table under a condition, as a plain number. */
const countWhere = async (table: typeof jobCards | typeof customers | typeof vehicles, where: ReturnType<typeof and>) => {
  const [{ value }] = await db.select({ value: count() }).from(table).where(where);
  return value;
};

/** The UTC calendar day, the key the revenue charts have always grouped by. */
const dayKey = (date: Date): string => date.toISOString().split('T')[0];

interface StatsInput {
  garageId: string;
}

export const compileStats = async ({ garageId }: StatsInput) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const weekAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

  const startTime = Date.now();
  const chartLocale = await resolveChartLocale(garageId);

  const inGarage = eq(jobCards.garageId, garageId);
  const paidInvoices = and(eq(invoices.garageId, garageId), eq(invoices.paymentStatus, 'paid'));

  const [
    totalCustomers,
    totalVehicles,
    activeJobCards,
    todayJobCards,
    pendingEstimations,
    inProgressJobs,
    readyForPickup,
    [todayRevenue],
    [monthRevenue],
    [unpaidInvoices],
    lowStockItems,
    recentJobCards,
    recentInvoices,
    upcomingReminders,
    monthJobCards,
    weeklyPaid,
    jobStatusCounts
  ] = await Promise.all([
    countWhere(customers, eq(customers.garageId, garageId)),
    countWhere(vehicles, eq(vehicles.garageId, garageId)),
    countWhere(jobCards, and(inGarage, sql`${jobCards.status} not in ('delivered', 'cancelled')`)),
    countWhere(jobCards, and(inGarage, gte(jobCards.createdAt, today), lt(jobCards.createdAt, tomorrow))),
    countWhere(jobCards, and(inGarage, inArray(jobCards.status, ['new', 'estimation_sent']))),
    countWhere(jobCards, and(inGarage, eq(jobCards.status, 'in_progress'))),
    countWhere(jobCards, and(inGarage, eq(jobCards.status, 'ready_for_pickup'))),
    db.select({ total: sum(invoices.grandTotal) }).from(invoices)
      .where(and(paidInvoices, gte(invoices.paidAt, today), lt(invoices.paidAt, tomorrow))),
    db.select({ total: sum(invoices.grandTotal) }).from(invoices)
      .where(and(paidInvoices, gte(invoices.paidAt, monthStart), lt(invoices.paidAt, tomorrow))),
    db.select({
      total: sql<string | null>`sum(${invoices.grandTotal} - ${invoices.amountPaid})`,
      count: count()
    }).from(invoices)
      .where(and(eq(invoices.garageId, garageId), inArray(invoices.paymentStatus, ['unpaid', 'partial']))),
    db.select({
      _id: inventory._id, partName: inventory.partName, quantity: inventory.quantity,
      threshold: inventory.threshold, category: inventory.category
    }).from(inventory)
      .where(and(eq(inventory.garageId, garageId), eq(inventory.isActive, true), lte(inventory.quantity, inventory.threshold)))
      .orderBy(asc(inventory.quantity)).limit(10),
    db.query.jobCards.findMany({
      columns: { _id: true, jobCardNumber: true, status: true, createdAt: true, vehicleId: true, customerId: true, assignedMechanicId: true },
      with: {
        vehicle: { columns: { _id: true, licensePlate: true, make: true, model: true } },
        customer: { columns: { _id: true, name: true, phone: true } },
        assignedMechanic: { columns: { _id: true, name: true } }
      },
      where: inGarage,
      orderBy: [desc(jobCards.createdAt)],
      limit: 5
    }),
    db.query.invoices.findMany({
      columns: { _id: true, invoiceNumber: true, grandTotal: true, paymentStatus: true, createdAt: true, customerId: true, vehicleId: true },
      with: {
        customer: { columns: { _id: true, name: true } },
        vehicle: { columns: { _id: true, licensePlate: true } }
      },
      where: eq(invoices.garageId, garageId),
      orderBy: [desc(invoices.createdAt)],
      limit: 5
    }),
    db.query.serviceReminders.findMany({
      with: {
        vehicle: { columns: { _id: true, licensePlate: true, make: true, model: true } },
        customer: { columns: { _id: true, name: true, phone: true } }
      },
      where: and(
        eq(serviceReminders.garageId, garageId),
        eq(serviceReminders.status, 'pending'),
        lte(serviceReminders.nextServiceDate, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
      ),
      orderBy: [asc(serviceReminders.nextServiceDate)],
      limit: 10
    }),
    // Staff achievement input: this month's non-cancelled cards with their labour lines.
    db.select({ assignedMechanicId: jobCards.assignedMechanicId, estimation: jobCards.estimation }).from(jobCards)
      .where(and(inGarage, ne(jobCards.status, 'cancelled'), gte(jobCards.createdAt, monthStart))),
    // Weekly revenue — last 7 days, bucketed by day below
    db.select({ paidAt: invoices.paidAt, grandTotal: invoices.grandTotal }).from(invoices)
      .where(and(paidInvoices, gte(invoices.paidAt, weekAgo))),
    // Job status breakdown
    db.select({ status: jobCards.status, count: count() }).from(jobCards).where(inGarage).groupBy(jobCards.status)
  ]);

  const queryTime = Date.now() - startTime;
  if (queryTime > 2000) {
    log.warn('Slow stats compilation', { garageId, queryTimeMs: queryTime });
  }

  // Staff achievement — labour value and job count per mechanic this month,
  // formerly an aggregation pipeline with a `$lookup` on users.
  const perMechanic = new Map<string | null, { totalLabor: number; jobCount: number }>();
  monthJobCards.forEach(card => {
    const labor = card.estimation?.labor ?? [];
    const laborValue = labor.reduce((total, l) => total + (l.hours || 0) * (l.ratePerHour || 0), 0);
    const entry = perMechanic.get(card.assignedMechanicId) ?? { totalLabor: 0, jobCount: 0 };
    entry.totalLabor += laborValue;
    entry.jobCount += 1;
    perMechanic.set(card.assignedMechanicId, entry);
  });
  const mechanicIds = [...perMechanic.keys()].filter((id): id is string => !!id);
  const staffRows = mechanicIds.length
    ? await db.select({ _id: users._id, name: users.name, role: users.role }).from(users).where(inArray(users._id, mechanicIds))
    : [];
  const staffById = new Map(staffRows.map(s => [s._id, s]));
  const staffAchievement = [...perMechanic.entries()]
    .map(([id, totals]) => ({
      _id: id,
      staffName: (id && staffById.get(id)?.name) || 'Unassigned',
      role: (id && staffById.get(id)?.role) || 'mechanic',
      totalLabor: totals.totalLabor,
      jobCount: totals.jobCount
    }))
    .sort((a, b) => b.totalLabor - a.totalLabor);

  // Build a full 7-day revenue array (fill missing days with 0)
  const revenueMap: Record<string, number> = {};
  weeklyPaid.forEach(row => {
    if (!row.paidAt) return;
    const key = dayKey(row.paidAt);
    revenueMap[key] = (revenueMap[key] || 0) + row.grandTotal;
  });
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() - (6 - i) * 24 * 60 * 60 * 1000);
    const key = dayKey(d);
    return {
      date: key,
      label: formatDate(d, { locale: chartLocale.locale }, { weekday: 'short', day: 'numeric' }),
      revenue: revenueMap[key] || 0
    };
  });

  // Build job status breakdown map
  const statusBreakdown: Record<string, number> = {};
  jobStatusCounts.forEach(s => { statusBreakdown[s.status] = s.count; });

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
      today: Number(todayRevenue?.total) || 0,
      month: Number(monthRevenue?.total) || 0
    },
    unpaid: {
      total: Number(unpaidInvoices?.total) || 0,
      count: unpaidInvoices?.count || 0
    },
    weeklyRevenue: last7Days,
    jobStatusBreakdown: statusBreakdown,
    lowStockItems: lowStockItems.map(item => ({ ...item, isLowStock: true })),
    recentJobCards: recentJobCards.map(jobCardSummaryToApi),
    recentInvoices: recentInvoices.map(row => invoiceToApi(row)),
    upcomingReminders: upcomingReminders.map(r => ({
      ...reminderToApi(r),
      isOverdue: new Date(r.nextServiceDate) < new Date()
    })),
    staffAchievement,
    queryTimeMs: queryTime
  };
};

type GroupBy = 'day' | 'week' | 'month';

interface ChartDataInput {
  garageId: string;
  startDate: Date;
  endDate: Date;
  groupBy: GroupBy;
}

/**
 * The bucket a date falls in for a grouping mode. One function serves both
 * the invoices being bucketed and the period cursor that fills gaps, so the
 * two can never disagree about which week a Sunday belongs to.
 */
const periodKey = (date: Date, groupBy: GroupBy): string => {
  if (groupBy === 'month') {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }
  if (groupBy === 'week') {
    const jan1 = new Date(date.getFullYear(), 0, 1);
    const weekNum = Math.ceil(((date.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    return `${date.getFullYear()}-${String(weekNum).padStart(2, '0')}`;
  }
  return dayKey(date);
};

// ── Chart data for arbitrary date ranges ──────────────────────────────────────
export const getChartData = async ({ garageId, startDate, endDate, groupBy }: ChartDataInput) => {
  const chartLocale = await resolveChartLocale(garageId);

  const [paidRows, jobStatusRaw] = await Promise.all([
    // Revenue within the range, bucketed by period below
    db.select({ paidAt: invoices.paidAt, grandTotal: invoices.grandTotal }).from(invoices)
      .where(and(
        eq(invoices.garageId, garageId),
        eq(invoices.paymentStatus, 'paid'),
        gte(invoices.paidAt, startDate),
        lte(invoices.paidAt, endDate)
      )),

    // Job status breakdown within the date range (by createdAt)
    db.select({ status: jobCards.status, count: count() }).from(jobCards)
      .where(and(eq(jobCards.garageId, garageId), gte(jobCards.createdAt, startDate), lte(jobCards.createdAt, endDate)))
      .groupBy(jobCards.status)
  ]);

  // Fill all periods in the range with 0 for missing days/weeks/months
  const revenueMap: Record<string, { revenue: number; count: number }> = {};
  paidRows.forEach(row => {
    if (!row.paidAt) return;
    const key = periodKey(row.paidAt, groupBy);
    const bucket = revenueMap[key] ?? { revenue: 0, count: 0 };
    bucket.revenue += row.grandTotal;
    bucket.count += 1;
    revenueMap[key] = bucket;
  });

  const periods: { key: string; label: string; revenue: number; invoiceCount: number }[] = [];
  const cursor = new Date(startDate);
  const end = new Date(endDate);

  while (cursor <= end) {
    const key = periodKey(cursor, groupBy);
    let label: string;

    if (groupBy === 'month') {
      label = formatDate(cursor, { locale: chartLocale.locale }, { month: 'short', year: '2-digit' });
      cursor.setMonth(cursor.getMonth() + 1);
    } else if (groupBy === 'week') {
      label = `W${Number(key.slice(-2))}`;
      cursor.setDate(cursor.getDate() + 7);
    } else {
      label = formatDate(cursor, { locale: chartLocale.locale }, { weekday: 'short', day: 'numeric', month: 'short' });
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
  const jobStatusBreakdown: Record<string, number> = {};
  jobStatusRaw.forEach(s => { jobStatusBreakdown[s.status] = s.count; });

  return { revenueTrend: periods, jobStatusBreakdown };
};

// ── Monthly business metrics ─────────────────────────────────────────────────

interface MonthlyInput {
  garageId: string;
  /** `YYYY-MM`; defaults to the current month. */
  month?: string;
}

interface MonthFigures {
  month: string;
  /** Paid invoices, by the date they were paid. */
  revenue: number;
  /** Job cards billed in the month — an invoice is what makes a service a service. */
  services: number;
  /** Everything recorded in expenses, by expense date. */
  expenses: number;
  /** revenue - expenses. Negative when the month lost money. */
  netProfit: number;
}

const figuresFor = async (garageId: string, month: string): Promise<MonthFigures> => {
  const range = monthRange(month)!;
  const [[paid], [billed], [spent]] = await Promise.all([
    db.select({ total: sum(invoices.grandTotal) }).from(invoices).where(and(
      eq(invoices.garageId, garageId), eq(invoices.paymentStatus, 'paid'),
      gte(invoices.paidAt, range.start), lt(invoices.paidAt, range.end)
    )),
    db.select({ total: count() }).from(invoices).where(and(
      eq(invoices.garageId, garageId), gte(invoices.createdAt, range.start), lt(invoices.createdAt, range.end)
    )),
    db.select({ total: sum(expenses.amount) }).from(expenses).where(and(
      eq(expenses.garageId, garageId), gte(expenses.expenseDate, range.start), lt(expenses.expenseDate, range.end)
    ))
  ]);
  const revenue = Number(paid?.total) || 0;
  const spentTotal = Number(spent?.total) || 0;
  return {
    month,
    revenue,
    services: billed?.total || 0,
    expenses: spentTotal,
    netProfit: Math.round((revenue - spentTotal) * 100) / 100
  };
};

/**
 * The month at a glance: revenue, services, expenses, profit — for the month
 * asked for and the one before it so a client can show the change. Expense
 * categories are broken out because "where did it go" is the next question.
 */
export const compileMonthlyMetrics = async ({ garageId, month }: MonthlyInput) => {
  const key = month || monthKey(new Date());
  const range = monthRange(key);
  if (!range) throw new HttpError('Month must be YYYY-MM', 400);

  const [current, previous, byCategory] = await Promise.all([
    figuresFor(garageId, key),
    figuresFor(garageId, previousMonthKey(key)),
    db.select({ category: expenses.category, total: sum(expenses.amount), count: count() }).from(expenses)
      .where(and(eq(expenses.garageId, garageId), gte(expenses.expenseDate, range.start), lt(expenses.expenseDate, range.end)))
      .groupBy(expenses.category)
  ]);

  const totals = new Map<ExpenseCategory, { total: number; count: number }>(
    byCategory.map(r => [r.category, { total: Number(r.total) || 0, count: r.count }])
  );

  return {
    ...current,
    previous,
    expensesByCategory: EXPENSE_CATEGORIES
      .map(category => ({ category, total: totals.get(category)?.total || 0, count: totals.get(category)?.count || 0 }))
      .filter(c => c.count > 0)
      .sort((a, b) => b.total - a.total)
  };
};
