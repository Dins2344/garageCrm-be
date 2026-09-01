import mongoose, { Document, Schema, Types } from 'mongoose';
import { PaymentStatus, PAYMENT_STATUSES, PaymentMethod, PAYMENT_METHODS } from '../types/domain';
import { IEstimationPart, IEstimationLabor } from './JobCard';

export interface IInvoice extends Document {
  _id: Types.ObjectId;
  invoiceNumber: string;
  jobCard: Types.ObjectId;
  customer: Types.ObjectId;
  vehicle: Types.ObjectId;
  garage: Types.ObjectId;
  parts: IEstimationPart[];
  labor: IEstimationLabor[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  grandTotal: number;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  paidAt: Date | null;
  notes: string;
  createdBy: Types.ObjectId;
  isSample: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSchema = new Schema<IInvoice>({
  invoiceNumber: {
    type: String,
    required: true
  },
  jobCard: {
    type: Schema.Types.ObjectId,
    ref: 'JobCard',
    required: true
  },
  customer: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  vehicle: {
    type: Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  garage: {
    type: Schema.Types.ObjectId,
    ref: 'Garage',
    required: true
  },
  parts: [{
    inventoryItem: { type: Schema.Types.ObjectId, ref: 'Inventory' },
    partName: { type: String },
    quantity: { type: Number, default: 1 },
    unitPrice: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  }],
  labor: [{
    description: { type: String },
    hours: { type: Number, default: 1 },
    ratePerHour: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  }],
  subtotal: {
    type: Number,
    default: 0
  },
  taxRate: {
    type: Number,
    default: 18
  },
  taxAmount: {
    type: Number,
    default: 0
  },
  discount: {
    type: Number,
    default: 0
  },
  grandTotal: {
    type: Number,
    default: 0
  },
  paymentStatus: {
    type: String,
    enum: PAYMENT_STATUSES,
    default: 'unpaid'
  },
  paymentMethod: {
    type: String,
    enum: PAYMENT_METHODS,
    default: ''
  },
  amountPaid: {
    type: Number,
    default: 0
  },
  paidAt: {
    type: Date,
    default: null
  },
  notes: {
    type: String,
    default: ''
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // See the note on Customer.isSample — display and cleanup only.
  isSample: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// Auto-generate invoice number
invoiceSchema.pre('validate', async function (this: IInvoice) {
  if (this.isNew && !this.invoiceNumber) {
    const count = await mongoose.model('Invoice').countDocuments({ garage: this.garage });
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    this.invoiceNumber = `INV-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  }
});

invoiceSchema.index({ garage: 1, createdAt: -1 });
invoiceSchema.index({ garage: 1, paymentStatus: 1 });

export default mongoose.model<IInvoice>('Invoice', invoiceSchema);
