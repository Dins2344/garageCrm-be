import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { users } from '../config/schema';
import { Role, ROLES } from '../types/domain';
import { requiredString, optionalString, EMAIL_PATTERN } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

export { users };
export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Mongoose's `select: false` for the password and reset-token pair, as a
 * column list: use this in every query that returns a user to a caller. The
 * login and reset paths read the full row explicitly.
 */
export const USER_PUBLIC_COLUMNS = {
  _id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  garageId: true,
  avatar: true,
  isActive: true,
  createdAt: true,
  updatedAt: true
} as const;

export type PublicUser = Pick<UserRow, keyof typeof USER_PUBLIC_COLUMNS>;

// Permissive on purpose. Country-aware validation can't live here — the
// schema has no access to the garage's country at validate time — and a
// strict rule would reject existing users on unrelated profile updates.
// This is a shape check only; semantic validation belongs in the usecase.
const PHONE_PATTERN = /^\+?[0-9\s()\-]{6,20}$/;

const nameField = requiredString('Name is required').max(100, { error: 'Name cannot exceed 100 characters' });
const emailField = requiredString('Email is required').toLowerCase().regex(EMAIL_PATTERN, { error: 'Please provide a valid email' });
const phoneField = requiredString('Phone number is required').regex(PHONE_PATTERN, { error: 'Please provide a valid phone number' });
export const passwordField = z.string({ error: 'Password is required' }).min(6, { error: 'Password must be at least 6 characters' });

export const createUserSchema = z.object({
  name: nameField,
  email: emailField,
  phone: phoneField,
  password: passwordField,
  role: z.enum(ROLES, { error: `Role must be one of: ${ROLES.join(', ')}` }).default('mechanic'),
  avatar: optionalString(),
  isActive: z.boolean().default(true)
});

export const updateUserSchema = z.object({
  name: nameField.optional(),
  email: emailField.optional(),
  phone: phoneField.optional(),
  password: passwordField.optional(),
  role: z.enum(ROLES, { error: `Role must be one of: ${ROLES.join(', ')}` }).optional(),
  avatar: z.string().trim().optional(),
  isActive: z.boolean().optional()
});

/** Formerly `user.getSignedJwtToken()`. */
export const signUserToken = (user: { _id: string; role: Role | string }): string =>
  jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET as string, {
    expiresIn: process.env.JWT_EXPIRE
  } as jwt.SignOptions);

/** Never carries the password, whatever was selected. */
export const userToApi = (row: object): ApiObject => serializeRow(row);
