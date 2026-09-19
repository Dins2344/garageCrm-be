import { and, count, desc, eq, gte, lt, sum } from 'drizzle-orm';
import { db } from '../config/db';
import { expenses, createExpenseSchema, updateExpenseSchema, expenseToApi } from '../models/Expense';
import { USER_PUBLIC_COLUMNS } from '../models/User';
import { EXPENSE_CATEGORIES, ExpenseCategory } from '../types/domain';
import { runSchema } from '../utils/validation';
import { pagination, textMatches } from '../utils/query';
import { monthRange } from '../utils/dates';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

const log = logger.child('ExpenseUsecase');

const WITH_CREATOR = { createdBy: { columns: USER_PUBLIC_COLUMNS } } as const;

const isCategory = (value: string): value is ExpenseCategory => (EXPENSE_CATEGORIES as readonly string[]).includes(value);

interface ListInput {
  garageId: string;
  /** `YYYY-MM`; when given, only that month's expenses. */
  month?: string;
  category?: string;
  search?: string;
  page?: number | string;
  limit?: number | string;
}

/**
 * Newest expense first, within a month when one is asked for. The list
 * also answers the filtered total so the page can show it without a second
 * request that could disagree with the rows.
 */
export const getExpensesList = async ({ garageId, month, category, search, page = 1, limit = 20 }: ListInput) => {
  const paging = pagination(page, limit);
  const range = month ? monthRange(month) : null;
  if (month && !range) throw new HttpError('Month must be YYYY-MM', 400);
  if (category && !isCategory(category)) {
    throw new HttpError(`Category must be one of: ${EXPENSE_CATEGORIES.join(', ')}`, 400);
  }
  const term = search?.trim();

  const where = and(
    eq(expenses.garageId, garageId),
    range ? gte(expenses.expenseDate, range.start) : undefined,
    range ? lt(expenses.expenseDate, range.end) : undefined,
    category ? eq(expenses.category, category as ExpenseCategory) : undefined,
    term ? textMatches(expenses.title, term) : undefined
  );

  const [[{ total, amount }], rows] = await Promise.all([
    db.select({ total: count(), amount: sum(expenses.amount) }).from(expenses).where(where),
    db.query.expenses.findMany({
      with: WITH_CREATOR,
      where,
      orderBy: [desc(expenses.expenseDate), desc(expenses.createdAt), desc(expenses._id)],
      offset: paging.offset,
      limit: paging.limit
    })
  ]);

  return {
    expenses: rows.map(expenseToApi),
    total,
    totalAmount: Number(amount) || 0,
    page: paging.page,
    limit: paging.limit
  };
};

interface ByIdInput {
  expenseId: string;
  garageId: string;
}

export const getExpenseById = async ({ expenseId, garageId }: ByIdInput): Promise<ApiObject> => {
  const row = await db.query.expenses.findFirst({
    where: and(eq(expenses._id, expenseId), eq(expenses.garageId, garageId)),
    with: WITH_CREATOR
  });
  if (!row) throw new HttpError('Expense not found', 404);
  return expenseToApi(row);
};

interface CreateInput {
  garageId: string;
  userId: string;
  data: Record<string, unknown>;
}

export const recordExpense = async ({ garageId, userId, data }: CreateInput): Promise<ApiObject> => {
  const input = runSchema(createExpenseSchema, data);
  const [created] = await db.insert(expenses).values({ ...input, garageId, createdById: userId }).returning({ _id: expenses._id });
  log.info('Expense recorded', { garageId, expenseId: created._id, amount: input.amount, category: input.category });
  return getExpenseById({ expenseId: created._id, garageId });
};

interface UpdateInput extends ByIdInput {
  data: Record<string, unknown>;
}

export const updateExpense = async ({ expenseId, garageId, data }: UpdateInput): Promise<ApiObject> => {
  const changes = runSchema(updateExpenseSchema, data);
  const scope = and(eq(expenses._id, expenseId), eq(expenses.garageId, garageId));

  const updated = Object.keys(changes).length === 0
    ? await db.query.expenses.findFirst({ columns: { _id: true }, where: scope })
    : (await db.update(expenses).set(changes).where(scope).returning({ _id: expenses._id }))[0];
  if (!updated) throw new HttpError('Expense not found', 404);

  log.info('Expense updated', { garageId, expenseId, fields: Object.keys(changes) });
  return getExpenseById({ expenseId, garageId });
};

export const removeExpense = async ({ expenseId, garageId }: ByIdInput): Promise<true> => {
  const deleted = await db.delete(expenses)
    .where(and(eq(expenses._id, expenseId), eq(expenses.garageId, garageId)))
    .returning({ _id: expenses._id });
  if (!deleted.length) throw new HttpError('Expense not found', 404);
  log.info('Expense deleted', { garageId, expenseId });
  return true;
};
