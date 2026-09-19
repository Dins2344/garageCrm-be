import express from 'express';
const router = express.Router();
import { getExpenses, getExpense, createExpense, updateExpense, deleteExpense } from '../controllers/expenseController';
import { protect, authorize } from '../middleware/auth';

// Money going out is the owner's business — and the admin's, who runs the
// counter. Nobody else sees it.
router.use(protect, authorize('owner', 'admin'));

router.route('/')
  .get(getExpenses)
  .post(createExpense);

router.route('/:id')
  .get(getExpense)
  .put(updateExpense)
  .delete(deleteExpense);

export default router;
