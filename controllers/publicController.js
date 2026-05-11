const publicUsecase = require('../usecases/publicUsecase');

// @desc    Get estimation details by token (customer-facing, no auth)
// @route   GET /api/public/estimate/:token
exports.getEstimation = async (req, res, next) => {
  try {
    const jobCard = await publicUsecase.getEstimationByToken(req.params.token);
    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    next(error);
  }
};

// @desc    Customer approves estimation by token (no auth)
// @route   POST /api/public/estimate/:token/approve
exports.approveEstimation = async (req, res, next) => {
  try {
    const jobCard = await publicUsecase.approveEstimationByToken(req.params.token);
    res.status(200).json({ success: true, data: jobCard, message: 'Estimation approved successfully.' });
  } catch (error) {
    next(error);
  }
};
