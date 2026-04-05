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

router.route('/')
  .get(authorize('owner', 'admin', 'service_advisor', 'receptionist'), asyncHandler(getUsers))
  .post(authorize('owner', 'admin'), asyncHandler(createUser));

router.route('/:id')
  .get(authorize('owner', 'admin'), asyncHandler(getUser))
  .put(authorize('owner', 'admin'), asyncHandler(updateUser))
  .delete(authorize('owner'), asyncHandler(deleteUser));

module.exports = router;
