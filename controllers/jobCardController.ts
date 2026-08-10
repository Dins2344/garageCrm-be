import { Request, Response, NextFunction } from 'express';
import * as jobCardUsecase from '../usecases/jobCardUsecase';
import logger from '../utils/logger';
const log = logger.child('JobCardController');

// @desc    Get all job cards
// @route   GET /api/jobcards
export const getJobCards = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, mechanicId, vehicle, search, page, limit } = req.query as Record<string, string | undefined>;
    const garageId = req.user!.garage._id;
    log.info('Fetching job cards list', { garageId, status, mechanicId, vehicle, search, page, limit });

    const { jobCards, total, page: currentPage, limit: currentLimit } = await jobCardUsecase.getActivityList({
      garageId,
      role: req.user!.role,
      userId: req.user!._id,
      status,
      mechanicId,
      vehicleId: vehicle,
      search,
      page,
      limit
    });

    log.info('Job cards list fetched', { garageId, count: jobCards.length, total });
    res.status(200).json({
      success: true,
      count: jobCards.length,
      total,
      pages: Math.ceil(total / currentLimit),
      currentPage,
      data: jobCards
    });
  } catch (error) {
    log.error('Failed to fetch job cards', { garageId: req.user?.garage?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Get single job card
// @route   GET /api/jobcards/:id
export const getJobCard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Fetching single job card', { jobCardId: id, garageId });
    const jobCard = await jobCardUsecase.getJobCardDetails({ jobCardId: id, garageId });
    log.info('Job card fetched successfully', { jobCardId: id, status: jobCard.status });
    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    log.error('Failed to fetch job card', { jobCardId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Create job card
// @route   POST /api/jobcards
export const createJobCard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const garageId = req.user!.garage._id;
    log.info('Creating new job card', { garageId, userId: req.user!._id, serviceType: req.body.serviceType });

    const jobCard = await jobCardUsecase.openJobCard({
      jobCardData: req.body,
      garageId,
      userId: req.user!._id
    });

    // Populate for response
    const populated = await jobCardUsecase.getJobCardDetails({ jobCardId: String(jobCard._id), garageId });
    log.info('Job card created successfully', { jobCardId: jobCard._id, jobCardNumber: jobCard.jobCardNumber, garageId });
    res.status(201).json({ success: true, data: populated });
  } catch (error) {
    log.error('Failed to create job card', { garageId: req.user?.garage?._id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update job card
// @route   PUT /api/jobcards/:id
export const updateJobCard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Updating job card', { jobCardId: id, garageId, userId: req.user!._id, fields: Object.keys(req.body) });

    const jobCard = await jobCardUsecase.updateJobCardProgress({
      jobCardId: id,
      garageId,
      userId: req.user!._id,
      updateData: req.body
    });

    log.info('Job card updated', { jobCardId: id, newStatus: jobCard?.status });
    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    log.error('Failed to update job card', { jobCardId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Update estimation
// @route   PUT /api/jobcards/:id/estimation
export const updateEstimation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Updating job card estimation', { jobCardId: id, garageId });

    const jobCard = await jobCardUsecase.calculateAndSaveEstimation({
      jobCardId: id,
      garageId,
      estimationData: req.body
    });

    log.info('Estimation saved', { jobCardId: id, grandTotal: jobCard.estimation?.grandTotal });
    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    log.error('Failed to update estimation', { jobCardId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Approve estimation
// @route   PUT /api/jobcards/:id/approve
export const approveEstimation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Approving estimation', { jobCardId: id, garageId, userId: req.user!._id });

    const jobCard = await jobCardUsecase.approveJobEstimation({
      jobCardId: id,
      garageId,
      userId: req.user!._id
    });

    log.info('Estimation approved', { jobCardId: id });
    res.status(200).json({ success: true, data: jobCard });
  } catch (error) {
    log.error('Failed to approve estimation', { jobCardId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Delete job card
// @route   DELETE /api/jobcards/:id
export const deleteJobCard = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Deleting job card', { jobCardId: id, garageId });

    await jobCardUsecase.removeJobCard({ jobCardId: id, garageId });

    log.info('Job card deleted', { jobCardId: id, garageId });
    res.status(200).json({ success: true, message: 'Job card deleted successfully' });
  } catch (error) {
    log.error('Failed to delete job card', { jobCardId: req.params.id, error: (error as Error).message });
    next(error);
  }
};

// @desc    Download estimation as PDF
// @route   GET /api/jobcards/:id/estimation/download
export const downloadEstimation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const id = req.params.id as string;
    const garageId = req.user!.garage._id;
    log.info('Estimation PDF download requested', { jobCardId: id, garageId, userId: req.user!._id });

    const { buffer, jobCardNumber } = await jobCardUsecase.generateEstimationPDFBuffer({
      jobCardId: id,
      garageId
    });

    log.info('Streaming estimation PDF to client', { jobCardId: id, jobCardNumber, bytes: buffer.length });
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Estimation-${jobCardNumber}.pdf"`,
      'Content-Length': buffer.length
    });
    res.send(buffer);
  } catch (error) {
    log.error('Failed to generate estimation PDF', { jobCardId: req.params.id, error: (error as Error).message });
    next(error);
  }
};
