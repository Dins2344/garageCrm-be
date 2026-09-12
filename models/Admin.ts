import { z } from 'zod';
import { admins } from '../config/schema';
import { requiredString, EMAIL_PATTERN } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

/**
 * Platform super-admin.
 *
 * Deliberately a separate table from `users`, not a new role on it:
 *
 * - `users.garage_id` is NOT NULL, because every user belongs to exactly one
 *   tenant. A platform admin belongs to none, so it would need that constraint
 *   loosened — and loosening a required column on the tenant table to make
 *   room for a non-tenant actor is how tenant scoping quietly erodes.
 * - `Role` in `types/domain.ts` is mirrored by hand into both client repos.
 *   Adding `super_admin` there would ripple into two codebases for an actor
 *   neither client ever renders.
 *
 * `adminUsecase` is already the only cross-tenant module in the codebase; this
 * table belongs to it and to nothing else. Passwords are hashed by the caller
 * with `utils/password.ts` — there is no save hook to do it silently.
 */
export { admins };
export type AdminRow = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;

export const createAdminSchema = z.object({
  name: requiredString('Name is required').max(100, { error: 'Name cannot exceed 100 characters' }),
  email: requiredString('Email is required').toLowerCase().regex(EMAIL_PATTERN, { error: 'Please provide a valid email' }),
  // Longer floor than User's 6: this account can read and delete across every
  // tenant on the platform.
  password: z.string({ error: 'Password is required' }).min(12, { error: 'Admin password must be at least 12 characters' }),
  isActive: z.boolean().default(true)
});

export const adminToApi = (row: AdminRow): ApiObject => serializeRow(row);
