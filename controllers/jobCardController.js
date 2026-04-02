const jobCardUsecase = require('../usecases/jobCardUsecase');
const logger = require('../utils/logger');
const log = logger.child('JobCardController');

// @desc    Get all job cards
// @route   GET /api/jobcards
exports.getJobCards = async (req, res, next) => {
  try {
    const { status, mechanicId, search, page, limit } = req.query;
    const { jobCards, total, page: currentPage, limit: currentLimit } = await jobCardUsecase.getActivityList({
      garageId: req.user.garage._id,
      role: req.user.role,
      userId: req.user._id,
      status,
      mechanicId,
      search,
      page,
      limit
    });

    res.status(200).json({
      success: true,
      count: jobCards.length,
      total,
      pages: Math.ceil(total / currentLimit),
      currentPage,
      data: jobCards
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single job card
// @route   GET /api/jobcards/:id
exports.getJobCard = async (req, res, next) => {
  try {
    const jobCard = await jobCardUsecase.getJobCardDetails({
      jobCardId: req.params.id,
      garageId: req.user.garage._id
    });
    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    next(error);
  }
};

// @desc    Create job card
// @route   POST /api/jobcards
exports.createJobCard = async (req, res, next) => {
  try {
    const jobCard = await jobCardUsecase.openJobCard({
      jobCardData: req.body,
      garageId: req.user.garage._id,
      userId: req.user._id
    });

    // Populate for response
    const populated = await jobCardUsecase.getJobCardDetails({
      jobCardId: jobCard._id,
      garageId: req.user.garage._id
    });

    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    next(error);
  }
};

// @desc    Update job card
// @route   PUT /api/jobcards/:id
exports.updateJobCard = async (req, res, next) => {
  try {
    const jobCard = await jobCardUsecase.updateJobCardProgress({
      jobCardId: req.params.id,
      garageId: req.user.garage._id,
      userId: req.user._id,
      updateData: req.body
    });

    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    next(error);
  }
};

// @desc    Update estimation
// @route   PUT /api/jobcards/:id/estimation
exports.updateEstimation = async (req, res, next) => {
  try {
    const jobCard = await jobCardUsecase.calculateAndSaveEstimation({
      jobCardId: req.params.id,
      garageId: req.user.garage._id,
      estimationData: req.body
    });

    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve estimation
// @route   PUT /api/jobcards/:id/approve
exports.approveEstimation = async (req, res, next) => {
  try {
    const jobCard = await jobCardUsecase.approveJobEstimation({
      jobCardId: req.params.id,
      garageId: req.user.garage._id,
      userId: req.user._id
    });

    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete job card
// @route   DELETE /api/jobcards/:id
exports.deleteJobCard = async (req, res, next) => {
  try {
    await jobCardUsecase.removeJobCard({
      jobCardId: req.params.id,
      garageId: req.user.garage._id
    });

    res.status(200).json({ success: true, message: 'Job card deleted successfully' });
  } catch (error) {
    next(error);
  }
};
