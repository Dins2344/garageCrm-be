import { z } from 'zod';
import { isFileId } from '../services/ids';

export const NO_ACCESS = "You don't have access to this garage.";
export const OWNER_ONLY = 'Only the garage owner can do this.';
export const TAKEN = 'This garage is already shared by someone else.';
export const GARAGE_BAD_INPUT = 'Garage request was not valid.';
export const NOT_A_MEMBER = 'That person is not in this garage.';
export const OWNER_FIXED = 'The garage owner cannot be changed or removed. Delete the garage instead.';

export const garageIdSchema = z.string().refine(isFileId);
export const memberIdSchema = z.string().min(1).max(64);
export const roleSchema = z.object({ role: z.enum(['editor', 'viewer']) });
export const releaseSchema = z.object({
  records: z.array(z.object({ tbl: z.string().min(1).max(64), id: z.string().min(1).max(64) })).max(500),
  fileIds: z.array(z.string().uuid()).max(100)
});
