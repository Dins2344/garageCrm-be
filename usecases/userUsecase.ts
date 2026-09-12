import { and, count, eq, ne } from 'drizzle-orm';
import { db } from '../config/db';
import { users, USER_PUBLIC_COLUMNS, createUserSchema, updateUserSchema, userToApi } from '../models/User';
import { hashPassword } from '../utils/password';
import { runSchema } from '../utils/validation';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { FREE_PLAN_LIMITS } from '../config/planLimits';

const log = logger.child('UserUsecase');

interface ListInput {
  garageId: string;
}

export const getStaffList = async ({ garageId }: ListInput): Promise<ApiObject[]> => {
  log.info('Fetching staff list', { garageId });
  const rows = await db.query.users.findMany({
    columns: USER_PUBLIC_COLUMNS,
    where: eq(users.garageId, garageId)
  });
  log.info('Staff list fetched', { garageId, count: rows.length });
  return rows.map(userToApi);
};

interface GetByIdInput {
  staffId: string;
  garageId: string;
}

export const getStaffMember = async ({ staffId, garageId }: GetByIdInput): Promise<ApiObject> => {
  log.info('Fetching staff member', { staffId, garageId });
  const user = await db.query.users.findFirst({
    columns: USER_PUBLIC_COLUMNS,
    where: and(eq(users._id, staffId), eq(users.garageId, garageId))
  });
  if (!user) {
    log.warn('Staff member not found', { staffId, garageId });
    throw new HttpError('User not found', 404);
  }
  return userToApi(user);
};

interface RegisterInput {
  staffData: Record<string, unknown>;
  garageId: string;
}

export const registerStaff = async ({ staffData, garageId }: RegisterInput): Promise<ApiObject> => {
  log.info('Registering new staff member', { garageId, role: staffData.role, email: staffData.email });

  const [{ staffCount }] = await db.select({ staffCount: count() }).from(users)
    .where(and(eq(users.garageId, garageId), ne(users.role, 'owner')));
  if (staffCount >= FREE_PLAN_LIMITS.maxStaffPerGarage) {
    throw new HttpError(
      `Staff limit reached (${FREE_PLAN_LIMITS.maxStaffPerGarage} per garage) on the free plan.`,
      403
    );
  }

  const input = runSchema(createUserSchema, staffData);
  const [user] = await db.insert(users).values({
    ...input,
    password: await hashPassword(input.password),
    garageId
  }).returning();

  log.info('New staff registered', { userId: user._id, role: user.role, garageId });
  return userToApi(user);
};

interface UpdateInput {
  staffId: string;
  garageId: string;
  updateData: Record<string, unknown>;
}

export const updateStaffDetails = async ({ staffId, garageId, updateData }: UpdateInput): Promise<ApiObject> => {
  log.info('Updating staff details', { staffId, garageId, fields: Object.keys(updateData) });

  const changes = runSchema(updateUserSchema, updateData);
  if (changes.password) {
    changes.password = await hashPassword(changes.password);
    log.info('Password hashed before staff update', { staffId });
  }

  const scope = and(eq(users._id, staffId), eq(users.garageId, garageId));
  const user = Object.keys(changes).length === 0
    ? await db.query.users.findFirst({ where: scope })
    : (await db.update(users).set(changes).where(scope).returning())[0];

  if (!user) {
    log.warn('Staff member not found for update', { staffId, garageId });
    throw new HttpError('User not found', 404);
  }

  log.info('Staff details updated', { staffId });
  return userToApi(user);
};

interface DeactivateInput {
  staffId: string;
  garageId: string;
  action: string;
}

export const deactivateStaff = async ({ staffId, garageId, action }: DeactivateInput): Promise<ApiObject> => {
  log.info('Toggling staff account status', { staffId, garageId, action });
  const [user] = await db.update(users)
    .set({ isActive: action === 'activate' })
    .where(and(eq(users._id, staffId), eq(users.garageId, garageId)))
    .returning();

  if (!user) {
    log.warn('Staff member not found for status toggle', { staffId, garageId });
    throw new HttpError('User not found', 404);
  }

  log.info(`Staff account ${user.isActive ? 'activated' : 'deactivated'}`, { staffId, garageId });
  return userToApi(user);
};

interface RemoveInput {
  staffId: string;
  garageId: string;
}

export const removeStaff = async ({ staffId, garageId }: RemoveInput): Promise<true> => {
  log.info('Removing staff member', { staffId, garageId });
  const deleted = await db.delete(users)
    .where(and(eq(users._id, staffId), eq(users.garageId, garageId)))
    .returning({ _id: users._id });
  if (deleted.length === 0) {
    log.warn('Staff member not found for deletion', { staffId, garageId });
    throw new HttpError('User not found', 404);
  }
  log.info('Staff member removed', { staffId, garageId });
  return true;
};
