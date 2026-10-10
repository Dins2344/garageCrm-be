import { z } from 'zod';
import { changeRequests } from '../config/schema';
import { CHANGE_REQUEST_TYPES } from '../types/domain';
import { idField, oneOf } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

export { changeRequests };
export type ChangeRequestRow = typeof changeRequests.$inferSelect;

/** The envelope every request arrives in; `payload` is checked per type afterwards. */
export const raiseChangeRequestSchema = z.object({
  type: oneOf(CHANGE_REQUEST_TYPES, 'Request type'),
  targetId: idField('Target is required'),
  payload: z.record(z.string(), z.unknown(), { error: 'Payload must be an object' }).default({})
});

/** Body of approve and reject. */
export const decisionSchema = z.object({
  note: z.string({ error: 'Note must be text' }).trim().max(500, { error: 'Note cannot exceed 500 characters' }).default('')
});

export const changeRequestToApi = (row: object): ApiObject => serializeRow(row);
