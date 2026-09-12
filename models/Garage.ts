import { z } from 'zod';
import { garages, Address, GarageSettings, EMPTY_ADDRESS } from '../config/schema';
import { DEFAULT_COUNTRY, SUPPORTED_COUNTRY_CODES } from '../config/countries';
import { requiredString, optionalString, numberField } from '../utils/validation';
import { serializeRow, ApiObject } from '../utils/serialize';

export { garages };
export type GarageRow = typeof garages.$inferSelect;
export type NewGarage = typeof garages.$inferInsert;
export type { Address as GarageAddress, GarageSettings };

export const addressSchema = z.object({
  street: optionalString(),
  city: optionalString(),
  state: optionalString(),
  pincode: optionalString()
});

export const EMPTY_GARAGE_ADDRESS = EMPTY_ADDRESS;

// Presentation overrides. '' = inherit from config/countries.ts via
// utils/locale.ts, so a table correction reaches every garage.
// taxRate / laborRatePerHour are seeded from the garage's country at creation,
// then owner-owned. These must NOT track the country table — a tax-rate change
// in law must never retroactively rewrite an existing garage's configured rate.
export const settingsSchema = z.object({
  currency: optionalString(),
  locale: optionalString(),
  taxLabel: optionalString(),
  timezone: optionalString(),
  taxRate: numberField('Tax rate must be a number').default(18),
  laborRatePerHour: numberField('Labour rate must be a number').default(500),
  serviceReminderDays: numberField('Reminder days must be a number').default(180)
});

/**
 * Business tax registration number. Deliberately permissive: this holds a
 * GSTIN in India, a VAT number in the UK/EU, an EIN in the US, an ABN in
 * Australia — a country-specific regex here would reject every one of them.
 * Format hints belong in the UI as soft guidance, not as a hard validator.
 */
const GST_PATTERN = /^$|^[A-Za-z0-9\-/ ]{1,25}$/;

export const createGarageSchema = z.object({
  name: requiredString('Garage name is required').max(200, { error: 'Name cannot exceed 200 characters' }),
  country: z.string().trim().toUpperCase().default(DEFAULT_COUNTRY)
    .refine(v => (SUPPORTED_COUNTRY_CODES as readonly string[]).includes(v), { error: 'Unsupported country' }),
  address: addressSchema.default(EMPTY_ADDRESS),
  phone: requiredString('Garage phone is required'),
  email: optionalString(),
  gstNumber: optionalString().pipe(z.string().regex(GST_PATTERN, { error: 'Invalid tax registration number' })),
  logo: optionalString()
});

/**
 * A partial update. Nested objects are partial too: `garageUsecase` merges
 * them key by key into the stored JSONB, so a caller sending only
 * `{ settings: { taxRate } }` never wipes the other settings.
 *
 * Written out rather than derived with `.partial()`: zod keeps a field's
 * `.default()` when it is made optional, so a partial derived from the create
 * schema would fill every omitted key with its default — and the merge would
 * then overwrite the stored values with blanks.
 */
export const addressUpdateSchema = z.object({
  street: z.string().trim().optional(),
  city: z.string().trim().optional(),
  state: z.string().trim().optional(),
  pincode: z.string().trim().optional()
});

export const settingsUpdateSchema = z.object({
  currency: z.string().trim().optional(),
  locale: z.string().trim().optional(),
  taxLabel: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  taxRate: numberField('Tax rate must be a number').optional(),
  laborRatePerHour: numberField('Labour rate must be a number').optional(),
  serviceReminderDays: numberField('Reminder days must be a number').optional()
});

export const updateGarageSchema = z.object({
  name: requiredString('Garage name is required').max(200, { error: 'Name cannot exceed 200 characters' }).optional(),
  phone: requiredString('Garage phone is required').optional(),
  email: z.string().trim().optional(),
  gstNumber: z.string().trim().regex(GST_PATTERN, { error: 'Invalid tax registration number' }).optional(),
  address: addressUpdateSchema.optional(),
  settings: settingsUpdateSchema.optional(),
  country: z.string().trim().toUpperCase().optional()
});

export const garageToApi = (row: object): ApiObject => serializeRow(row);
