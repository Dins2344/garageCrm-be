const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');
const { protect, authorize } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

router.use(protect);
router.use(authorize('owner', 'admin'));

router.route('/')
  .get(asyncHandler(getUsers))
  .post(asyncHandler(createUser));

router.route('/:id')
  .get(asyncHandler(getUser))
  .put(asyncHandler(updateUser))
  .delete(authorize('owner'), asyncHandler(deleteUser));

module.exports = router;
