import { Types } from 'mongoose';
import Garage, { IGarage } from '../models/Garage';
import logger from '../utils/logger';
import { HttpError } from '../utils/httpError';

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
