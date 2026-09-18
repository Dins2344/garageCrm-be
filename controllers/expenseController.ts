import { Request, Response, NextFunction } from 'express';
import * as expenseUsecase from '../usecases/expenseUsecase';
import logger from '../utils/logger';
const log = logger.child('ExpenseController');

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

// @desc    List expenses (owner, admin)
// @route   GET /api/expenses
export const getExpenses = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = req.query as Record<string, string | string[] | undefined>;
    const garageId = req.garageId!;
    log.info('Fetching expenses', { garageId, month: q.month, category: q.category });

    const { expenses, total, totalAmount, page, limit } = await expenseUsecase.getExpensesList({
      garageId,
      month: first(q.month),
      category: first(q.category),
      search: first(q.search),
      page: first(q.page),
      limit: first(q.limit)
    });

    res.status(200).json({
      success: true,
      count: expenses.length,
      total,
      totalAmount,
      pages: Math.ceil(total / limit),
      currentPage: page,
      data: expenses
    });
  } catch (error) {
    log.error('Failed to fetch expenses', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get one expense
// @route   GET /api/expenses/:id
export const getExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expense = await expenseUsecase.getExpenseById({ expenseId: req.params.id as string, garageId: req.garageId! });
    res.status(200).json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
};

// @desc    Record an expense
// @route   POST /api/expenses
export const createExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expense = await expenseUsecase.recordExpense({
      garageId: req.garageId!,
      userId: String(req.user!._id),
      data: req.body
    });
    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    log.warn('Failed to record expense', { garageId: req.garageId, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update an expense
// @route   PUT /api/expenses/:id
export const updateExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const expense = await expenseUsecase.updateExpense({
      expenseId: req.params.id as string,
      garageId: req.garageId!,
      data: req.body
    });
    res.status(200).json({ success: true, data: expense });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete an expense
// @route   DELETE /api/expenses/:id
export const deleteExpense = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    await expenseUsecase.removeExpense({ expenseId: req.params.id as string, garageId: req.garageId! });
    res.status(200).json({ success: true, message: 'Expense deleted' });
  } catch (error) {
    next(error);
  }
};
