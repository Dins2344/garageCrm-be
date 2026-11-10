import { z } from 'zod';
import { syncRecords } from '../config/schema';
import { isFileId } from '../services/ids';

export { syncRecords };

export const SYNC_BAD_INPUT = 'Sync data was not in the expected format.';
export const MAX_PUSH = 200;
export const MAX_PULL = 500;

const base64 = /^[A-Za-z0-9+/]*={0,2}$/;

export const changeSchema = z.object({
  tbl: z.string().regex(/^[a-z_]{1,40}$/),
  id: z.string().min(1).max(64),
  updatedAt: z.number().int().min(0),
  deletedAt: z.number().int().min(0).nullable(),
  payload: z.string().max(65536).regex(base64)
});

export const pushSchema = z.object({ changes: z.array(changeSchema).max(MAX_PUSH) });

const wireScope = z.string().refine((s) => s === 'personal' || isFileId(s));

export const scopedChangeSchema = changeSchema.extend({ scope: wireScope });
export const scopedPushSchema = z.object({ changes: z.array(scopedChangeSchema).max(MAX_PUSH) });
export const pullSchema = z.object({
  cursors: z.record(wireScope, z.number().int().min(0)).refine((c) => Object.keys(c).length <= 50),
  limit: z.number().optional()
});
