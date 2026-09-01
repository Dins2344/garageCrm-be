import mongoose, { Document, Schema, Types } from 'mongoose';

export interface ICustomerAddress {
  street: string;
  city: string;
  state: string;
  pincode: string;
}

export interface ICustomer extends Document {
  _id: Types.ObjectId;
  name: string;
  phone: string;
  email: string;
  address: ICustomerAddress;
  vehicles: Types.ObjectId[];
  garage: Types.ObjectId;
  totalVisits: number;
  totalSpent: number;
  notes: string;
  isSample: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = new Schema<ICustomer>({
  name: {
    type: String,
    required: [true, 'Customer name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required']
  },
  email: {
    type: String,
    default: ''
  },
  address: {
    street: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    pincode: { type: String, default: '' }
  },
  vehicles: [{
    type: Schema.Types.ObjectId,
    ref: 'Vehicle'
  }],
  garage: {
    type: Schema.Types.ObjectId,
    ref: 'Garage',
    required: true
  },
  totalVisits: {
    type: Number,
    default: 0
  },
  totalSpent: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    default: ''
  },
  // Seeded demo row, created with the garage so a brand-new account is not an
  // empty app. A display and cleanup flag only — never an access-control one;
  // `garage` is still the sole tenant boundary on every query.
  isSample: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Index for fast search by phone or name within a garage
customerSchema.index({ garage: 1, phone: 1 }, { unique: true });
customerSchema.index({ garage: 1, name: 'text' });

export default mongoose.model<ICustomer>('Customer', customerSchema);
