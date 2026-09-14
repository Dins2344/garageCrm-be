import crypto from 'crypto';
import { and, eq, gt } from 'drizzle-orm';
import { db } from '../config/db';
import {
  users, UserRow, PublicUser, USER_PUBLIC_COLUMNS, createUserSchema, updateUserSchema, passwordField,
  signUserToken, userToApi
} from '../models/User';
import { garages, createGarageSchema } from '../models/Garage';
import { hashPassword, comparePassword } from '../utils/password';
import { runSchema } from '../utils/validation';
import { newId } from '../utils/ids';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { COUNTRIES, DEFAULT_COUNTRY, isSupportedCountry } from '../config/countries';
import { isValidPhoneForCountry } from '../utils/phone';
import { isValidTimezone } from '../utils/locale';
import { sendPasswordResetEmail } from '../services/emailService';
import { seedSampleData } from './sampleDataUsecase';

const log = logger.child('AuthUsecase');

/** The shape every auth endpoint hands the controller: a public user with `garage` as an id. */
export type AuthUser = ApiObject & { _id: string; role: string; garage: string };

const toAuthUser = (row: PublicUser | UserRow): AuthUser => userToApi(row) as AuthUser;

interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
  garageName?: string;
  garagePhone?: string;
  garageAddress?: Record<string, unknown>;
  country?: string;
  /** Only meaningful for countries spanning several zones (US/CA/AU). */
  timezone?: string;
}

export const registerNewGarage = async (userData: RegisterInput): Promise<{ user: AuthUser; token: string }> => {
  const { name, email, phone, password, garageName, garagePhone, garageAddress } = userData;

  // Default to India so existing clients that don't send a country keep the
  // behaviour they've always had.
  const requestedCountry = userData.country?.toUpperCase();
  if (requestedCountry && !isSupportedCountry(requestedCountry)) {
    throw new HttpError(`Unsupported country: ${requestedCountry}`, 400);
  }
  const country = isSupportedCountry(requestedCountry) ? requestedCountry : DEFAULT_COUNTRY;
  const countryDefaults = COUNTRIES[country];

  // Shape checks first (required fields, email format, password length) so a
  // malformed signup gets the same 400 messages the schema validators used to
  // produce, before any country logic runs.
  const userInput = runSchema(createUserSchema, { name, email, phone, password, role: 'owner' });

  // Country-aware phone validation lives here, not on the schema: the User
  // table can't see which country the garage is being created in at validate
  // time. It also restores a check India lost — the old schema regex
  // `/^[6-9]\d{9}$/` was deliberately loosened so non-Indian numbers could be
  // stored, which left nothing rejecting malformed input. This is the only
  // gate, so it has to be here rather than nowhere.
  if (!isValidPhoneForCountry(phone, country)) {
    throw new HttpError(
      `Please enter a valid phone number for ${countryDefaults.name} (e.g. ${countryDefaults.phoneExample}).`,
      400
    );
  }
  if (garagePhone && !isValidPhoneForCountry(garagePhone, country)) {
    throw new HttpError(
      `Please enter a valid garage phone number for ${countryDefaults.name} (e.g. ${countryDefaults.phoneExample}).`,
      400
    );
  }

  // Ignored for single-zone countries — the country table is authoritative
  // there, and storing a redundant override would freeze it against fixes.
  const timezone =
    countryDefaults.timezone === null && userData.timezone ? userData.timezone.trim() : '';
  if (timezone && !isValidTimezone(timezone)) {
    throw new HttpError(`Unrecognised timezone: ${userData.timezone}`, 400);
  }

  // Check if user exists
  const existingUser = await db.query.users.findFirst({ columns: { _id: true }, where: eq(users.email, userInput.email) });
  if (existingUser) {
    throw new HttpError('Email already registered', 400);
  }

  const garageInput = runSchema(createGarageSchema, {
    name: garageName || `${name}'s Garage`,
    phone: garagePhone || phone,
    address: garageAddress || {},
    country
  });

  // One transaction: the garage is inserted first (its owner column is
  // nullable for exactly this moment), then the user pointing at it, then the
  // owner link. Either every row exists and they are linked, or none does —
  // the ownerless-garage failure mode the old two-step create had is gone.
  const garageId = newId();
  const passwordHash = await hashPassword(userInput.password);

  const user = await db.transaction(async tx => {
    await tx.insert(garages).values({
      _id: garageId,
      ...garageInput,
      // Seeded once from the country, then owned by the garage — see the note
      // in config/countries.ts on why these must not track the table.
      settings: {
        currency: '',
        locale: '',
        taxLabel: '',
        // Only stored when the country has no single zone of its own; for
        // everywhere else '' means "inherit from the country table", so a
        // later correction to that table reaches existing garages.
        timezone,
        taxRate: countryDefaults.defaultTaxRate,
        laborRatePerHour: countryDefaults.defaultLaborRatePerHour,
        serviceReminderDays: 180
      }
    });

    const [created] = await tx.insert(users).values({
      ...userInput,
      password: passwordHash,
      garageId
    }).returning();

    await tx.update(garages).set({ ownerId: created._id }).where(eq(garages._id, garageId));
    return created;
  });

  log.info('New garage and owner registered', { garageId, userId: user._id });

  // Deliberately NOT rolled back on failure, and deliberately outside the
  // transaction above. That transaction protects an invariant — a user and a
  // garage must both exist or neither does. This is a nicety: a signup that
  // fails because a demo customer could not be written is far worse than an
  // empty garage. The owner can seed nothing and still use the product.
  try {
    await seedSampleData({ garageId, ownerId: user._id, country });
  } catch (err) {
    log.error('Sample data seeding failed', {
      garageId,
      error: (err as Error).message
    });
  }

  const token = signUserToken(user);
  return { user: toAuthUser(user), token };
};

interface AuthenticateInput {
  email: string;
  password: string;
}

export const authenticateUser = async ({ email, password }: AuthenticateInput): Promise<{ user: AuthUser; token: string }> => {
  if (!email || !password) {
    throw new HttpError('Please provide email and password', 400);
  }

  // Check for user. Deliberately NOT joining `garage` here — the client-side
  // User type (web and mobile) expects garage as a plain id string, matching
  // what /auth/register already returns; populating it silently breaks any
  // string comparison against garage ids (e.g. the mobile branch switcher).
  const user = await db.query.users.findFirst({ where: eq(users.email, String(email).toLowerCase()) });
  if (!user) {
    throw new HttpError('Invalid credentials', 401);
  }

  // Check if password matches
  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) {
    throw new HttpError('Invalid credentials', 401);
  }

  // Check if user is active
  if (!user.isActive) {
    throw new HttpError('Account has been deactivated', 403);
  }

  log.info('User authenticated successfully', { userId: user._id, role: user.role });

  const token = signUserToken(user);
  return { user: toAuthUser(user), token };
};

interface UpdateProfileInput {
  userId: string;
  updateData: { name?: string; phone?: string };
}

export const updateUserProfile = async ({ userId, updateData }: UpdateProfileInput): Promise<ApiObject | null> => {
  const changes = runSchema(updateUserSchema.pick({ name: true, phone: true }), updateData);
  const current = await db.query.users.findFirst({ columns: USER_PUBLIC_COLUMNS, where: eq(users._id, userId) });
  if (!current) {
    return null;
  }
  if (Object.keys(changes).length === 0) {
    return userToApi(current);
  }

  // A verified mark describes one specific number. A new number starts over.
  const phoneChanged = changes.phone !== undefined && changes.phone !== current.phone;
  const [user] = await db.update(users)
    .set({ ...changes, ...(phoneChanged ? { phoneVerifiedAt: null } : {}) })
    .where(eq(users._id, userId))
    .returning();
  return user ? userToApi(user) : null;
};

interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
}

export const changeUserPassword = async ({ userId, currentPassword, newPassword }: ChangePasswordInput): Promise<true> => {
  const user = await db.query.users.findFirst({ where: eq(users._id, userId) });

  if (!user || !(await comparePassword(currentPassword || '', user.password))) {
    throw new HttpError('Current password is incorrect', 401);
  }

  const password = runSchema(passwordField, newPassword);
  await db.update(users).set({ password: await hashPassword(password) }).where(eq(users._id, userId));
  return true;
};

interface ForgotPasswordInput {
  email: string;
  frontendUrl: string;
}

type ForgotPasswordStatus = 'sent' | 'staff-managed' | 'not-found';

/**
 * Only owners can self-service reset their password by email — staff accounts
 * are managed by their garage's owner (who can already set a new password for
 * them directly via the Edit Staff flow), so this deliberately does not issue
 * a token for non-owner roles. The caller maps the status to a user-facing
 * message; 'sent' and 'not-found' should render identically so this endpoint
 * can't be used to enumerate valid owner emails.
 */
export const forgotPassword = async ({ email, frontendUrl }: ForgotPasswordInput): Promise<{ status: ForgotPasswordStatus }> => {
  const user = await db.query.users.findFirst({
    columns: USER_PUBLIC_COLUMNS,
    where: eq(users.email, String(email || '').toLowerCase())
  });
  if (!user) {
    return { status: 'not-found' };
  }
  if (user.role !== 'owner') {
    return { status: 'staff-managed' };
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  await db.update(users).set({
    resetPasswordToken: crypto.createHash('sha256').update(rawToken).digest('hex'),
    resetPasswordExpire: new Date(Date.now() + 30 * 60 * 1000)
  }).where(eq(users._id, user._id));

  await sendPasswordResetEmail({
    to: user.email,
    name: user.name,
    resetUrl: `${frontendUrl}/reset-password/${rawToken}`
  });

  log.info('Password reset email sent', { userId: user._id });
  return { status: 'sent' };
};

interface ResetPasswordInput {
  token: string;
  newPassword: string;
}

export const resetPassword = async ({ token, newPassword }: ResetPasswordInput): Promise<true> => {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

  const user = await db.query.users.findFirst({
    columns: { _id: true },
    where: and(eq(users.resetPasswordToken, hashedToken), gt(users.resetPasswordExpire, new Date()))
  });

  if (!user) {
    throw new HttpError('This reset link is invalid or has expired.', 400);
  }

  const password = runSchema(passwordField, newPassword);
  await db.update(users).set({
    password: await hashPassword(password),
    resetPasswordToken: null,
    resetPasswordExpire: null
  }).where(eq(users._id, user._id));

  log.info('Password reset successfully', { userId: user._id });
  return true;
};
