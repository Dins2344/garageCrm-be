import { z } from 'zod';
import { expenses } from '../config/schema';
import { EXPENSE_CATEGORIES, PAYMENT_METHODS } from '../types/domain';
import { requiredString, optionalString, oneOf, boundedNumber } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

export { expenses };
export type ExpenseRow = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;

const amountField = boundedNumber('Amount must be a number', { min: [0.01, 'Amount must be greater than zero'] });

/** `expenseDate` arrives as an ISO string or a `YYYY-MM-DD`; either coerces. */
const expenseDateField = z.coerce.date({ error: 'Expense date is required' });

export const createExpenseSchema = z.object({
  title: requiredString('Title is required'),
  category: oneOf(EXPENSE_CATEGORIES, 'Category').default('other'),
  amount: amountField,
  expenseDate: expenseDateField,
  paymentMethod: oneOf(PAYMENT_METHODS, 'Payment method').default(''),
  notes: optionalString()
});

export const updateExpenseSchema = z.object({
  title: requiredString('Title is required').optional(),
  category: oneOf(EXPENSE_CATEGORIES, 'Category').optional(),
  amount: amountField.optional(),
  expenseDate: expenseDateField.optional(),
  paymentMethod: oneOf(PAYMENT_METHODS, 'Payment method').optional(),
  notes: z.string().trim().optional()
});

export const expenseToApi = (row: object): ApiObject => serializeRow(row);
