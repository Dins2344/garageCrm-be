import express from 'express';
const router = express.Router();
import { getExpenses, getExpense, createExpense, updateExpense, deleteExpense } from '../controllers/expenseController';
import { protect, authorize } from '../middleware/auth';
import asyncHandler from '../middleware/asyncHandler';

// Money going out is the owner's business — and the admin's, who runs the
// counter. Nobody else sees it.
router.use(protect, authorize('owner', 'admin'));

router.route('/')
  .get(asyncHandler(getExpenses))
  .post(asyncHandler(createExpense));

router.route('/:id')
  .get(asyncHandler(getExpense))
  .put(asyncHandler(updateExpense))
  .delete(asyncHandler(deleteExpense));

export default router;
