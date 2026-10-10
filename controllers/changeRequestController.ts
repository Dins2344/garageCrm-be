import { Request, Response } from 'express';
import * as changeRequestUsecase from '../usecases/changeRequestUsecase';

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);
const actor = (req: Request) => ({
  garageId: req.garageId!,
  userId: String(req.user!._id),
  userName: req.user!.name,
  role: req.user!.role
});

// @desc    Ask an owner/admin to make a change (staff)
// @route   POST /api/change-requests
export const createChangeRequest = async (req: Request, res: Response): Promise<void> => {
  const data = await changeRequestUsecase.raiseChangeRequest({ ...actor(req), data: req.body ?? {} });
  res.status(201).json({ success: true, data });
};

// @desc    Requests in this branch (owner/admin) or the caller's own (staff)
// @route   GET /api/change-requests
export const getChangeRequests = async (req: Request, res: Response): Promise<void> => {
  const q = req.query as Record<string, string | string[] | undefined>;
  const { requests, total, page, limit } = await changeRequestUsecase.listChangeRequests({
    ...actor(req),
    status: first(q.status),
    type: first(q.type),
    targetId: first(q.targetId),
    page: first(q.page),
    limit: first(q.limit)
  });
  res.status(200).json({
    success: true, count: requests.length, total, pages: Math.ceil(total / limit), currentPage: page, data: requests
  });
};

// @route   GET /api/change-requests/:id
export const getChangeRequest = async (req: Request, res: Response): Promise<void> => {
  const data = await changeRequestUsecase.getChangeRequest({ ...actor(req), requestId: req.params.id as string });
  res.status(200).json({ success: true, data });
};

// @route   PUT /api/change-requests/:id/withdraw
export const withdrawChangeRequest = async (req: Request, res: Response): Promise<void> => {
  const data = await changeRequestUsecase.withdrawChangeRequest({ ...actor(req), requestId: req.params.id as string });
  res.status(200).json({ success: true, data });
};

// @desc    Approve, which applies the change (owner, admin)
// @route   PUT /api/change-requests/:id/approve
export const approveChangeRequest = async (req: Request, res: Response): Promise<void> => {
  const data = await changeRequestUsecase.approveChangeRequest({ ...actor(req), requestId: req.params.id as string, data: req.body ?? {} });
  res.status(200).json({ success: true, data });
};

// @desc    Reject with an optional note (owner, admin)
// @route   PUT /api/change-requests/:id/reject
export const rejectChangeRequest = async (req: Request, res: Response): Promise<void> => {
  const data = await changeRequestUsecase.rejectChangeRequest({ ...actor(req), requestId: req.params.id as string, data: req.body ?? {} });
  res.status(200).json({ success: true, data });
};
