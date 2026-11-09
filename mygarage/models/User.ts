import { users, refreshTokens } from '../config/schema';

export { users, refreshTokens };
export type UserRow = typeof users.$inferSelect;

export const toApi = (user: UserRow): { id: string; email: string } => ({ id: user.id, email: user.email });
