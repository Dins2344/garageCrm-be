import { Request, Response } from 'express';
import * as syncUsecase from '../usecases/syncUsecase';
import { pushSchema, SYNC_BAD_INPUT, MAX_PULL } from '../models/SyncRecord';
import { HttpError } from '../../utils/httpError';

const first = (v: unknown): string | undefined => {
  const value = Array.isArray(v) ? v[0] : v;
  return typeof value === 'string' ? value : undefined;
};

export const push = async (req: Request, res: Response): Promise<void> => {
  const parsed = pushSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(SYNC_BAD_INPUT, 400);
  const { accepted, skipped } = await syncUsecase.pushChanges({ userId: res.locals.mgUserId, changes: parsed.data.changes });
  res.json({ success: true, data: { accepted: accepted.length, skipped } });
};

export const pull = async (req: Request, res: Response): Promise<void> => {
  const rawSince = first(req.query.since);
  const rawLimit = first(req.query.limit);
  const since = rawSince === undefined ? 0 : Number(rawSince);
  if (rawSince === '' || !Number.isSafeInteger(since) || since < 0) throw new HttpError(SYNC_BAD_INPUT, 400);
  const asked = rawLimit === undefined ? MAX_PULL : Math.trunc(Number(rawLimit));
  const limit = Number.isFinite(asked) ? Math.min(MAX_PULL, Math.max(1, asked)) : MAX_PULL;
  res.json({ success: true, data: await syncUsecase.pullChanges({ userId: res.locals.mgUserId, since, limit }) });
};
