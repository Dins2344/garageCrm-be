import { and, asc, count, eq, ne, sql } from 'drizzle-orm';
import { db } from '../config/db';
import { garages, GarageRow, createGarageSchema, updateGarageSchema, garageToApi } from '../models/Garage';
import { users, USER_PUBLIC_COLUMNS, userToApi } from '../models/User';
import { runSchema } from '../utils/validation';
import { ApiObject } from '../utils/serialize';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { FREE_PLAN_LIMITS } from '../config/plans';
import { isSupportedCountry } from '../config/countries';
import { isValidTimezone } from '../utils/locale';

const log = logger.child('GarageUsecase');

interface GetByIdInput {
  garageId: string;
}

/**
 * Get garage by ID
 */
export const getGarageById = async ({ garageId }: GetByIdInput): Promise<ApiObject> => {
  const garage = await db.query.garages.findFirst({ where: eq(garages._id, garageId) });
  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }
  return garageToApi(garage);
};

/**
 * The two columns `resolveGarageLocale` reads, for the auth responses. Null
 * rather than 404 when missing — the locale resolver falls back to the
 * default country, which is what the auth payload wants.
 */
export const findGarageLocaleSource = async ({ garageId }: GetByIdInput): Promise<Pick<GarageRow, 'country' | 'settings'> | null> => {
  const garage = await db.query.garages.findFirst({
    columns: { country: true, settings: true },
    where: eq(garages._id, garageId)
  });
  return garage ?? null;
};

interface UpdateInput {
  garageId: string;
  updateData: Record<string, unknown>;
}

/**
 * Update garage info — only allows safe, pre-defined fields.
 *
 * `address` and `settings` are JSONB and are merged key by key (`||`) rather
 * than replaced, so a caller sending only `{ settings: { taxRate } }` never
 * wipes currency/laborRatePerHour/serviceReminderDays. This used to need a
 * dotted-path `$set` workaround; the merge operator is the native form.
 */
export const updateGarageInfo = async ({ garageId, updateData }: UpdateInput): Promise<ApiObject> => {
  // Validate the country here rather than leaning on a schema enum: a typo'd
  // country deserves a clear 400 with the offending value in it.
  if (updateData.country !== undefined) {
    const requested = String(updateData.country).toUpperCase();
    if (!isSupportedCountry(requested)) {
      throw new HttpError(`Unsupported country: ${updateData.country}`, 400);
    }
    updateData = { ...updateData, country: requested };
  }

  const changes = runSchema(updateGarageSchema, updateData);

  const requestedTimezone = changes.settings?.timezone;
  // '' is meaningful — it clears the override so the country table applies.
  if (requestedTimezone && !isValidTimezone(requestedTimezone)) {
    throw new HttpError(`Unrecognised timezone: ${requestedTimezone}`, 400);
  }

  // Changing country deliberately does NOT rewrite settings.taxRate. The rate
  // is seeded from the country once at creation and owned by the garage after
  // that; silently overwriting an owner's configured rate because they fixed
  // their country would be a worse surprise than showing them a stale one.
  // The Settings form keeps the rate field visible alongside the picker so the
  // change is theirs to make.

  const { address, settings, ...scalars } = changes;
  const set: Record<string, unknown> = { ...scalars };
  if (address && Object.keys(address).length > 0) {
    set.address = sql`${garages.address} || ${JSON.stringify(address)}::jsonb`;
  }
  if (settings && Object.keys(settings).length > 0) {
    set.settings = sql`${garages.settings} || ${JSON.stringify(settings)}::jsonb`;
  }

  const garage = Object.keys(set).length === 0
    ? await db.query.garages.findFirst({ where: eq(garages._id, garageId) })
    : (await db.update(garages).set(set).where(eq(garages._id, garageId)).returning())[0];

  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }

  log.info('Garage info updated', { garageId, fields: Object.keys(changes) });
  return garageToApi(garage);
};

interface ListOwnerGaragesInput {
  ownerId: string;
}

/**
 * List every garage owned by an owner — powers the garage switcher / branch list.
 */
export const listOwnerGarages = async ({ ownerId }: ListOwnerGaragesInput): Promise<ApiObject[]> => {
  const rows = await db.query.garages.findMany({
    where: eq(garages.ownerId, ownerId),
    orderBy: [asc(garages.createdAt)]
  });
  return rows.map(garageToApi);
};

interface CreateAdditionalGarageInput {
  ownerId: string;
  garageData: Record<string, unknown>;
}

/**
 * Create an additional branch for an existing owner, enforcing the free-plan cap.
 */
export const createAdditionalGarage = async ({ ownerId, garageData }: CreateAdditionalGarageInput): Promise<ApiObject> => {
  const [{ existingCount }] = await db.select({ existingCount: count() }).from(garages).where(eq(garages.ownerId, ownerId));
  if (existingCount >= FREE_PLAN_LIMITS.maxGaragesPerOwner) {
    throw new HttpError(
      `You've reached the maximum of ${FREE_PLAN_LIMITS.maxGaragesPerOwner} garages on the free plan.`,
      403
    );
  }

  // A branch inherits the owner's existing country and rates rather than
  // falling back to the India defaults — a GB owner's second branch must not
  // silently come out as an Indian garage. Uses the oldest garage (their
  // original one) as the template.
  const homeGarage = await db.query.garages.findFirst({
    where: eq(garages.ownerId, ownerId),
    orderBy: [asc(garages.createdAt)]
  });

  const input = runSchema(createGarageSchema, {
    ...(homeGarage ? { country: homeGarage.country } : {}),
    ...garageData
  });

  const [garage] = await db.insert(garages).values({
    ...input,
    ownerId,
    ...(homeGarage ? { settings: homeGarage.settings } : {})
  }).returning();

  log.info('Additional garage created', { garageId: garage._id, ownerId, country: garage.country });
  return garageToApi(garage);
};

interface BranchStaffInput {
  ownerId: string;
  garageId: string;
}

const ownedGarage = async (ownerId: string, garageId: string): Promise<GarageRow> => {
  const garage = await db.query.garages.findFirst({
    where: and(eq(garages._id, garageId), eq(garages.ownerId, ownerId))
  });
  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }
  return garage;
};

/**
 * Staff (non-owner users) assigned to a specific branch — used by the client
 * to decide, before deleting a branch, whether to ask the owner what to do
 * with them (delete vs. reassign to another branch).
 */
export const getBranchStaff = async ({ ownerId, garageId }: BranchStaffInput): Promise<ApiObject[]> => {
  await ownedGarage(ownerId, garageId);
  const staff = await db.query.users.findMany({
    columns: USER_PUBLIC_COLUMNS,
    where: and(eq(users.garageId, garageId), ne(users.role, 'owner'))
  });
  return staff.map(userToApi);
};

interface DeleteBranchInput {
  ownerId: string;
  garageId: string;
  staffAction?: 'delete' | 'reassign';
  reassignToGarageId?: string;
}

/**
 * Delete one of an owner's branches.
 *
 * - Always refuses if it's the owner's only branch — every owner must have
 *   at least one.
 * - If the branch has staff assigned, the caller must say what to do with
 *   them (`staffAction`); this is a real, owner-facing choice made in the
 *   UI, not something to default silently. `getBranchStaff` above is what
 *   the client calls first to find out whether it needs to ask.
 * - The owner's own `users.garage_id` is always repointed if it was
 *   pointing at the deleted branch — target garage on 'reassign', otherwise
 *   the oldest remaining branch — since leaving it dangling would break
 *   their own login. (The foreign key would now refuse the delete outright,
 *   but the repoint is what keeps the owner signed in.)
 * - All business data scoped to the branch (customers, vehicles, job cards,
 *   invoices, inventory, reminders) goes with it through the `garage_id`
 *   cascade; that data isn't something the "reassign" choice applies to,
 *   only staff accounts are.
 */
export const deleteBranch = async ({ ownerId, garageId, staffAction, reassignToGarageId }: DeleteBranchInput) => {
  const garage = await ownedGarage(ownerId, garageId);

  const allGarages = await db.query.garages.findMany({
    columns: { _id: true },
    where: eq(garages.ownerId, ownerId),
    orderBy: [asc(garages.createdAt)]
  });
  if (allGarages.length <= 1) {
    throw new HttpError('You must have at least one branch. This is your only branch and cannot be deleted.', 400);
  }
  const remaining = allGarages.filter(g => g._id !== garageId);

  const [{ staffCount }] = await db.select({ staffCount: count() }).from(users)
    .where(and(eq(users.garageId, garageId), ne(users.role, 'owner')));
  if (staffCount > 0 && !staffAction) {
    throw new HttpError(
      `This branch has ${staffCount} staff member(s) assigned. Specify staffAction ('delete' or 'reassign') to proceed.`,
      400
    );
  }

  let reassignTarget: string | null = null;
  if (staffAction === 'reassign') {
    if (!reassignToGarageId) {
      throw new HttpError('reassignToGarageId is required when staffAction is "reassign".', 400);
    }
    const target = remaining.find(g => g._id === reassignToGarageId);
    if (!target) {
      throw new HttpError('The target branch was not found among your other branches.', 400);
    }
    reassignTarget = target._id;
  }

  // Fallback branch for the owner's own `garage` ref if this was their default —
  // the reassign target if one was chosen, otherwise just the oldest survivor.
  const fallbackGarageId = reassignTarget ?? remaining[0]._id;

  await db.transaction(async tx => {
    await tx.update(users).set({ garageId: fallbackGarageId })
      .where(and(eq(users._id, ownerId), eq(users.garageId, garageId)));

    if (staffCount > 0) {
      if (staffAction === 'delete') {
        await tx.delete(users).where(and(eq(users.garageId, garageId), ne(users.role, 'owner')));
      } else {
        await tx.update(users).set({ garageId: reassignTarget! })
          .where(and(eq(users.garageId, garageId), ne(users.role, 'owner')));
      }
    }

    // Customers, vehicles, job cards, invoices, inventory and reminders all
    // cascade from garage_id.
    await tx.delete(garages).where(eq(garages._id, garageId));
  });

  log.warn('Owner deleted a branch', { ownerId, garageId, name: garage.name, staffAction: staffAction || 'none', staffCount });
  return { deletedGarageId: garage._id, fallbackGarageId };
};
