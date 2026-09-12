import { z } from 'zod';
import { vehicles } from '../config/schema';
import { FUEL_TYPES } from '../types/domain';
import { requiredString, optionalString, numberField, idField } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

export { vehicles };
export type VehicleRow = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

const plateField = requiredString('License plate is required').toUpperCase();
const yearField = z.preprocess(
  v => (v === '' || v === undefined ? null : v),
  numberField('Year must be a number').nullable()
);
const fuelField = z.enum(FUEL_TYPES, { error: `Fuel type must be one of: ${FUEL_TYPES.join(', ')}` });

export const createVehicleSchema = z.object({
  licensePlate: plateField,
  make: requiredString('Vehicle make is required'),
  model: requiredString('Vehicle model is required'),
  year: yearField.default(null),
  color: optionalString(),
  fuelType: fuelField.default('petrol'),
  vin: optionalString(),
  engineNumber: optionalString(),
  currentOdometerReading: numberField('Odometer must be a number').default(0),
  customer: idField('Customer is required')
});

export const updateVehicleSchema = z.object({
  licensePlate: plateField.optional(),
  make: requiredString('Vehicle make is required').optional(),
  model: requiredString('Vehicle model is required').optional(),
  year: yearField.optional(),
  color: z.string().trim().optional(),
  fuelType: fuelField.optional(),
  vin: z.string().trim().optional(),
  engineNumber: z.string().trim().optional(),
  currentOdometerReading: numberField('Odometer must be a number').optional(),
  customer: idField('Customer is required').optional()
});

/**
 * `serviceHistory` was an array of job-card ids maintained by hand on the
 * document. It is derived from `job_cards.vehicle_id` now: a query that joins
 * `jobCards` gets them emitted under the old key, anything else reports `[]`.
 */
export const vehicleToApi = (row: object): ApiObject => {
  const out = serializeRow(row);
  const history = out.jobCards;
  delete out.jobCards;
  out.serviceHistory = Array.isArray(history) ? history : [];
  return out;
};
