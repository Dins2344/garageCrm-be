import { Types } from 'mongoose';
import Garage, { IGarage } from '../models/Garage';
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
