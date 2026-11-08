import { Request, Response } from 'express';
import { z } from 'zod';
import * as fileUsecase from '../usecases/fileUsecase';
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
  res.json({ success: true, data: await fileUsecase.requestUpload({ userId: res.locals.mgUserId, fileId, size: size.data }) });
};

export const complete = async (req: Request, res: Response): Promise<void> => {
  const size = await fileUsecase.completeUpload({ userId: res.locals.mgUserId, fileId: fileIdOf(req) });
  res.json({ success: true, data: { size } });
};

export const downloadUrl = async (req: Request, res: Response): Promise<void> => {
  res.json({ success: true, data: await fileUsecase.requestDownload({ userId: res.locals.mgUserId, fileId: fileIdOf(req) }) });
};
