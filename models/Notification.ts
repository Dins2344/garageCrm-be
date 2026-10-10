import { notifications } from '../config/schema';
import { serializeRow, ApiObject } from '../utils/serialize';

export { notifications };
export type NotificationRow = typeof notifications.$inferSelect;

/** `entityId` goes out as `entity`, `userId` as `user`, `garageId` as `garage` — the serializer's usual rule. */
export const notificationToApi = (row: object): ApiObject => serializeRow(row);
