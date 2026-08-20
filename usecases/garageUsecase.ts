import { Types } from 'mongoose';
import Garage, { IGarage } from '../models/Garage';
import User from '../models/User';
import Customer from '../models/Customer';
import Vehicle from '../models/Vehicle';
import JobCard from '../models/JobCard';
import Invoice from '../models/Invoice';
import Inventory from '../models/Inventory';
import ServiceReminder from '../models/ServiceReminder';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';
import { FREE_PLAN_LIMITS } from '../config/planLimits';
import { isSupportedCountry } from '../config/countries';
import { isValidTimezone } from '../utils/locale';

const log = logger.child('GarageUsecase');

interface GetByIdInput {
  garageId: Types.ObjectId | string;
}

/**
 * Get garage by ID
 */
export const getGarageById = async ({ garageId }: GetByIdInput) => {
  const garage = await Garage.findById(garageId);
  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }
  return garage;
};

const ALLOWED_FIELDS = ['name', 'phone', 'email', 'gstNumber', 'address', 'settings', 'country'] as const;

// Sub-documents that must be merged key-by-key. `$set: { settings: {...} }`
// REPLACES the whole sub-document, so a caller sending only `{ taxRate }`
// silently wipes currency/laborRatePerHour/serviceReminderDays. Flattening to
// dotted paths (`settings.taxRate`) makes the update a merge instead.
const NESTED_FIELDS: readonly string[] = ['address', 'settings'];

interface UpdateInput {
  garageId: Types.ObjectId | string;
  updateData: Partial<IGarage>;
}

/**
 * Build a `$set` payload from the whitelisted fields, flattening nested
 * objects to dotted paths so partial updates merge rather than replace.
 */
const buildSetPayload = (updateData: Partial<IGarage>): Record<string, unknown> => {
  const $set: Record<string, unknown> = {};

  ALLOWED_FIELDS.forEach(field => {
    const value = updateData[field];
    if (value === undefined) return;

    const isMergeableObject =
      NESTED_FIELDS.includes(field) &&
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value);

    if (!isMergeableObject) {
      $set[field] = value;
      return;
    }

    Object.entries(value as unknown as Record<string, unknown>).forEach(([key, nestedValue]) => {
      if (nestedValue === undefined) return;
      // Never let caller-supplied keys build an operator or traverse deeper
      // than one level (mongoSanitize also strips `$`, but this is cheap).
      if (key.startsWith('$') || key.includes('.')) return;
      $set[`${field}.${key}`] = nestedValue;
    });
  });

  return $set;
};

/**
 * Update garage info — only allows safe, pre-defined fields
 */
export const updateGarageInfo = async ({ garageId, updateData }: UpdateInput) => {
  // Validate the country here rather than leaning on the schema enum: with
  // `runValidators` a bad code surfaces as a Mongoose ValidationError, and a
  // typo'd country deserves a clear 400.
  if (updateData.country !== undefined) {
    const requested = String(updateData.country).toUpperCase();
    if (!isSupportedCountry(requested)) {
      throw new HttpError(`Unsupported country: ${updateData.country}`, 400);
    }
    updateData = { ...updateData, country: requested };
  }

  const requestedTimezone = updateData.settings?.timezone;
  // '' is meaningful — it clears the override so the country table applies.
  if (requestedTimezone && !isValidTimezone(requestedTimezone)) {
    throw new HttpError(`Unrecognised timezone: ${requestedTimezone}`, 400);
  }

  const $set = buildSetPayload(updateData);

  // Changing country deliberately does NOT rewrite settings.taxRate. The rate
  // is seeded from the country once at creation and owned by the garage after
  // that; silently overwriting an owner's configured rate because they fixed
  // their country would be a worse surprise than showing them a stale one.
  // The Settings form keeps the rate field visible alongside the picker so the
  // change is theirs to make.

  const garage = await Garage.findByIdAndUpdate(
    garageId,
    { $set },
    { new: true, runValidators: true }
  );

  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }

  log.info('Garage info updated', { garageId, fields: Object.keys($set) });
  return garage;
};

interface ListOwnerGaragesInput {
  ownerId: Types.ObjectId | string;
}

/**
 * List every garage owned by an owner — powers the garage switcher / branch list.
 */
export const listOwnerGarages = async ({ ownerId }: ListOwnerGaragesInput) => {
  const garages = await Garage.find({ owner: ownerId }).sort({ createdAt: 1 });
  return garages;
};

interface CreateAdditionalGarageInput {
  ownerId: Types.ObjectId | string;
  garageData: Pick<IGarage, 'name' | 'phone'> & Partial<Pick<IGarage, 'email' | 'gstNumber' | 'address'>>;
}

/**
 * Create an additional branch for an existing owner, enforcing the free-plan cap.
 */
export const createAdditionalGarage = async ({ ownerId, garageData }: CreateAdditionalGarageInput) => {
  const existingCount = await Garage.countDocuments({ owner: ownerId });
  if (existingCount >= FREE_PLAN_LIMITS.maxGaragesPerOwner) {
    throw new HttpError(
      `You've reached the maximum of ${FREE_PLAN_LIMITS.maxGaragesPerOwner} garages on the free plan.`,
      403
    );
  }

  // A branch inherits the owner's existing country and rates rather than
  // falling back to the schema's India defaults — a GB owner's second branch
  // must not silently come out as an Indian garage. Uses the oldest garage
  // (their original one) as the template.
  const homeGarage = await Garage.findOne({ owner: ownerId }).sort({ createdAt: 1 });
  const inherited = homeGarage
    ? {
        country: homeGarage.country,
        settings: {
          taxRate: homeGarage.settings?.taxRate,
          laborRatePerHour: homeGarage.settings?.laborRatePerHour,
          currency: homeGarage.settings?.currency,
          locale: homeGarage.settings?.locale,
          taxLabel: homeGarage.settings?.taxLabel,
          timezone: homeGarage.settings?.timezone
        }
      }
    : {};

  const garage = await Garage.create({ ...inherited, ...garageData, owner: ownerId });
  log.info('Additional garage created', { garageId: garage._id, ownerId, country: garage.country });
  return garage;
};

interface BranchStaffInput {
  ownerId: Types.ObjectId | string;
  garageId: string;
}

/**
 * Staff (non-owner users) assigned to a specific branch — used by the client
 * to decide, before deleting a branch, whether to ask the owner what to do
 * with them (delete vs. reassign to another branch).
 */
export const getBranchStaff = async ({ ownerId, garageId }: BranchStaffInput) => {
  const garage = await Garage.findOne({ _id: garageId, owner: ownerId });
  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }
  const staff = await User.find({ garage: garageId, role: { $ne: 'owner' } }).select('-password');
  return staff;
};

interface DeleteBranchInput {
  ownerId: Types.ObjectId | string;
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
 * - The owner's own `User.garage` field is always repointed if it was
 *   pointing at the deleted branch — target garage on 'reassign', otherwise
 *   the oldest remaining branch — since leaving it dangling would break
 *   their own login (the exact bug class this whole feature has been about).
 * - All business data scoped to the branch (customers, vehicles, job cards,
 *   invoices, inventory, reminders) is deleted with it; that data isn't
 *   something the "reassign" choice applies to, only staff accounts are.
 */
export const deleteBranch = async ({ ownerId, garageId, staffAction, reassignToGarageId }: DeleteBranchInput) => {
  const garage = await Garage.findOne({ _id: garageId, owner: ownerId });
  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }

  const allGarages = await Garage.find({ owner: ownerId }).sort({ createdAt: 1 });
  if (allGarages.length <= 1) {
    throw new HttpError('You must have at least one branch. This is your only branch and cannot be deleted.', 400);
  }
  const remaining = allGarages.filter(g => String(g._id) !== String(garageId));

  const staffCount = await User.countDocuments({ garage: garageId, role: { $ne: 'owner' } });
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
    const target = remaining.find(g => String(g._id) === String(reassignToGarageId));
    if (!target) {
      throw new HttpError('The target branch was not found among your other branches.', 400);
    }
    reassignTarget = String(target._id);
  }

  // Fallback branch for the owner's own `garage` ref if this was their default —
  // the reassign target if one was chosen, otherwise just the oldest survivor.
  const fallbackGarageId = reassignTarget ?? String(remaining[0]._id);
  await User.updateOne({ _id: ownerId, garage: garageId }, { $set: { garage: fallbackGarageId } });

  if (staffCount > 0) {
    if (staffAction === 'delete') {
      await User.deleteMany({ garage: garageId, role: { $ne: 'owner' } });
    } else {
      await User.updateMany({ garage: garageId, role: { $ne: 'owner' } }, { $set: { garage: reassignTarget } });
    }
  }

  await Promise.all([
    Customer.deleteMany({ garage: garageId }),
    Vehicle.deleteMany({ garage: garageId }),
    JobCard.deleteMany({ garage: garageId }),
    Invoice.deleteMany({ garage: garageId }),
    Inventory.deleteMany({ garage: garageId }),
    ServiceReminder.deleteMany({ garage: garageId })
  ]);
  await Garage.findByIdAndDelete(garageId);

  log.warn('Owner deleted a branch', { ownerId, garageId, name: garage.name, staffAction: staffAction || 'none', staffCount });
  return { deletedGarageId: String(garage._id), fallbackGarageId };
};
