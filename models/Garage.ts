import mongoose, { Document, Schema, Types } from 'mongoose';

export interface IGarageAddress {
  street: string;
  city: string;
  state: string;
  pincode: string;
}

export interface IGarageSettings {
  currency: string;
  taxRate: number;
  laborRatePerHour: number;
  serviceReminderDays: number;
}

export interface IGarage extends Document {
  _id: Types.ObjectId;
  name: string;
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
  gstNumber: {
    type: String,
    default: '',
    match: [/^$|^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GST number']
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
    currency: { type: String, default: 'INR' },
    taxRate: { type: Number, default: 18 }, // GST percentage
    laborRatePerHour: { type: Number, default: 500 },
    serviceReminderDays: { type: Number, default: 180 } // 6 months default
  }
}, {
  timestamps: true
});

// A single owner cannot have two garages with the same name (their branches must be distinguishable).
garageSchema.index({ owner: 1, name: 1 }, { unique: true });

export default mongoose.model<IGarage>('Garage', garageSchema);
