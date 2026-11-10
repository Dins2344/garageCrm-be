import { Request, Response } from 'express';
import { z } from 'zod';
import * as fileUsecase from '../usecases/fileUsecase';
import { personalScope, garageScope } from '../services/scope';
import { requireMember } from '../usecases/garageUsecase';
import { GARAGE_BAD_INPUT, NO_ACCESS, garageIdSchema } from '../models/Garage';
import { HttpError } from '../../utils/httpError';

const fileIdSchema = z.string().uuid();
const sizeSchema = z.number().int().min(1);

const fileIdOf = (req: Request): string => {
  const parsed = fileIdSchema.safeParse(req.params.fileId);
  if (!parsed.success) throw new HttpError('That file reference is not valid.', 400);
  return parsed.data;
};

export const uploadUrl = async (req: Request, res: Response): Promise<void> => {
  const fileId = fileIdOf(req);
  const size = sizeSchema.safeParse(req.body?.size);
  if (!size.success) throw new HttpError('That file size is not valid.', 400);
  res.json({ success: true, data: await fileUsecase.requestUpload({ userId: res.locals.mgUserId, scope: personalScope(res.locals.mgUserId), fileId, size: size.data }) });
};

export const complete = async (req: Request, res: Response): Promise<void> => {
  const size = await fileUsecase.completeUpload({ userId: res.locals.mgUserId, scope: personalScope(res.locals.mgUserId), fileId: fileIdOf(req) });
  res.json({ success: true, data: { size } });
};

export const downloadUrl = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await fileUsecase.requestDownload({ userId: res.locals.mgUserId, scope: personalScope(res.locals.mgUserId), fileId: fileIdOf(req) }) });
};

/** Resolves `:scope` to a stored scope after checking the caller's role: writes need owner or editor, reads any member. */
const scopeOf = async (req: Request, res: Response, write: boolean): Promise<string> => {
  const userId: string = res.locals.mgUserId;
  if (req.params.scope === 'personal') return personalScope(userId);
  const garageId = garageIdSchema.safeParse(req.params.scope);
  if (!garageId.success) throw new HttpError(GARAGE_BAD_INPUT, 400);
  const role = await requireMember(userId, garageId.data);
  if (write && role === 'viewer') throw new HttpError(NO_ACCESS, 403);
  return garageScope(garageId.data);
};

export const uploadUrlV2 = async (req: Request, res: Response): Promise<void> => {
  const scope = await scopeOf(req, res, true);
  const fileId = fileIdOf(req);
  const size = sizeSchema.safeParse(req.body?.size);
  if (!size.success) throw new HttpError('That file size is not valid.', 400);
  res.json({ success: true, data: await fileUsecase.requestUpload({ userId: res.locals.mgUserId, scope, fileId, size: size.data }) });
};

export const completeV2 = async (req: Request, res: Response): Promise<void> => {
  const scope = await scopeOf(req, res, true);
  res.json({ success: true, data: { size: await fileUsecase.completeUpload({ userId: res.locals.mgUserId, scope, fileId: fileIdOf(req) }) } });
};

export const downloadUrlV2 = async (req: Request, res: Response): Promise<void> => {
  const scope = await scopeOf(req, res, false);
  res.json({ success: true, data: await fileUsecase.requestDownload({ userId: res.locals.mgUserId, scope, fileId: fileIdOf(req) }) });
};
