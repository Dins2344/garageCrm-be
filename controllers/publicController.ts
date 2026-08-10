import { Request, Response, NextFunction } from 'express';
import * as publicUsecase from '../usecases/publicUsecase';

// @desc    Get estimation details by token (customer-facing, no auth)
// @route   GET /api/public/estimate/:token
export const getEstimation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const jobCard = await publicUsecase.getEstimationByToken(req.params.token as string);
    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    next(error);
  }
};

// @desc    Customer approves estimation by token (no auth)
// @route   POST /api/public/estimate/:token/approve
export const approveEstimation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const jobCard = await publicUsecase.approveEstimationByToken(req.params.token as string);
    res.status(200).json({ success: true, data: jobCard, message: 'Estimation approved successfully.' });
  } catch (error) {
    next(error);
  }
};
