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

const ALLOWED_FIELDS = ['name', 'phone', 'email', 'gstNumber', 'address', 'settings'] as const;

interface UpdateInput {
  garageId: Types.ObjectId | string;
  updateData: Partial<IGarage>;
}

/**
 * Update garage info — only allows safe, pre-defined fields
 */
export const updateGarageInfo = async ({ garageId, updateData }: UpdateInput) => {
  const sanitized: Partial<IGarage> = {};
  ALLOWED_FIELDS.forEach(field => {
    if (updateData[field] !== undefined) {
      (sanitized as Record<string, unknown>)[field] = updateData[field];
    }
  });

  const garage = await Garage.findByIdAndUpdate(
    garageId,
    { $set: sanitized },
    { new: true, runValidators: true }
  );

  if (!garage) {
    throw new HttpError('Garage not found', 404);
  }

  log.info('Garage info updated', { garageId, fields: Object.keys(sanitized) });
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

  const garage = await Garage.create({ ...garageData, owner: ownerId });
  log.info('Additional garage created', { garageId: garage._id, ownerId });
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
