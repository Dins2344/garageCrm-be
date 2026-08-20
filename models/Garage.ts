import mongoose, { Document, Schema, Types } from 'mongoose';
import { DEFAULT_COUNTRY, SUPPORTED_COUNTRY_CODES } from '../config/countries';

export interface IGarageAddress {
  street: string;
  city: string;
  state: string;
  pincode: string;
}

export interface IGarageSettings {
  /** Presentation overrides — '' means "inherit from the country table". */
  currency: string;
  locale: string;
  taxLabel: string;
  timezone: string;
  /** Owned by the garage once seeded from its country at creation. */
  taxRate: number;
  laborRatePerHour: number;
  serviceReminderDays: number;
}

export interface IGarage extends Document {
  _id: Types.ObjectId;
  name: string;
  /** ISO 3166-1 alpha-2. Drives currency/locale/tax labels via config/countries.ts. */
  country: string;
  address: IGarageAddress;
  phone: string;
  email: string;
  gstNumber: string;
  logo: string;
  owner: Types.ObjectId;
  settings: IGarageSettings;
  createdAt: Date;
  updatedAt: Date;
}

const garageSchema = new Schema<IGarage>({
  name: {
    type: String,
    required: [true, 'Garage name is required'],
    trim: true,
    maxlength: [200, 'Name cannot exceed 200 characters']
  },
  // Deliberately NOT `required`: updateGarageInfo runs with runValidators, so
  // requiring it would make every pre-existing (country-less) garage fail
  // validation on unrelated edits. resolveGarageLocale falls back to IN, so
  // documents without this key already behave correctly.
  country: {
    type: String,
    uppercase: true,
    trim: true,
    default: DEFAULT_COUNTRY,
    enum: {
      values: SUPPORTED_COUNTRY_CODES,
      message: 'Unsupported country: {VALUE}'
    }
  },
  address: {
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    pincode: { type: String, default: '' }
  },
  phone: {
    type: String,
    required: [true, 'Garage phone is required']
  },
  email: {
    type: String,
    default: ''
  },
  // Business tax registration number. Deliberately permissive: this holds a
  // GSTIN in India, a VAT number in the UK/EU, an EIN in the US, an ABN in
  // Australia — a country-specific regex here would reject every one of them.
  // Format hints belong in the UI as soft guidance, not as a hard validator
  // (updateGarageInfo runs with runValidators, so a strict rule would also
  // start rejecting saves of pre-existing documents on unrelated edits).
  gstNumber: {
    type: String,
    default: '',
    match: [/^$|^[A-Za-z0-9\-/ ]{1,25}$/, 'Invalid tax registration number']
  },
  logo: {
    type: String,
    default: ''
  },
  owner: {
    type: Schema.Types.ObjectId,
    ref: 'User'
  },
  settings: {
    // Presentation overrides. '' = inherit from config/countries.ts via
    // utils/locale.ts, so a table correction reaches every garage.
    currency: { type: String, default: '' },
    locale: { type: String, default: '' },
    taxLabel: { type: String, default: '' },
    timezone: { type: String, default: '' },
    // Seeded from the garage's country at creation, then owner-owned. These
    // must NOT track the country table — a tax-rate change in law must never
    // retroactively rewrite an existing garage's configured rate.
    taxRate: { type: Number, default: 18 },
    laborRatePerHour: { type: Number, default: 500 },
    serviceReminderDays: { type: Number, default: 180 } // 6 months default
  }
}, {
  timestamps: true
});

// A single owner cannot have two garages with the same name (their branches must be distinguishable).
garageSchema.index({ owner: 1, name: 1 }, { unique: true });

export default mongoose.model<IGarage>('Garage', garageSchema);
