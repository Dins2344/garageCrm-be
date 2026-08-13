import mongoose, { Document, Schema, Types } from 'mongoose';
import { ServiceType, SERVICE_TYPES, ComplaintPriority, COMPLAINT_PRIORITIES, JobStatus, JOB_STATUSES } from '../types/domain';

export interface IComplaint {
  description: string;
  priority: ComplaintPriority;
}

export interface IJobCardPhoto {
  url: string;
  caption: string;
  uploadedAt: Date;
  uploadedBy: Types.ObjectId;
}

export interface IStatusHistoryEntry {
  status: string;
  changedBy: Types.ObjectId;
  changedAt: Date;
  notes: string;
}

export interface IEstimationPart {
  inventoryItem: Types.ObjectId;
  partName: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface IEstimationLabor {
  description: string;
  hours: number;
  ratePerHour: number;
  total: number;
}

export interface IEstimation {
  parts: IEstimationPart[];
  labor: IEstimationLabor[];
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  discount: number;
  grandTotal: number;
  approvedByCustomer: boolean;
  approvedAt: Date | null;
  sentAt: Date | null;
}

export interface IJobCard extends Document {
  _id: Types.ObjectId;
  serviceType: ServiceType;
  jobCardNumber: string;
  vehicle: Types.ObjectId;
  customer: Types.ObjectId;
  garage: Types.ObjectId;
  complaints: IComplaint[];
  photos: IJobCardPhoto[];
  assignedMechanic: Types.ObjectId | null;
  assignedAdvisor: Types.ObjectId | null;
  status: JobStatus;
  statusHistory: IStatusHistoryEntry[];
  estimation: IEstimation;
  odometerAtIntake: number;
  expectedDeliveryDate: Date | null;
  actualDeliveryDate: Date | null;
  internalNotes: string;
  invoice: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  estimationToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const jobCardSchema = new Schema<IJobCard>({
  serviceType: {
    type: String,
    enum: SERVICE_TYPES,
    required: true
  },
  jobCardNumber: {
    type: String,
    required: true
  },
  vehicle: {
    type: Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  customer: {
    type: Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  garage: {
    type: Schema.Types.ObjectId,
    ref: 'Garage',
    required: true
  },
  // Customer complaints / service requests
  complaints: [{
    description: { type: String, required: true },
    priority: { type: String, enum: COMPLAINT_PRIORITIES, default: 'medium' }
  }],
  // Vehicle photos (scratches, dents — for liability)
  photos: [{
    url: { type: String },
    caption: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' }
  }],
  // Mechanic assignment
  assignedMechanic: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  assignedAdvisor: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Job card status flow
  status: {
    type: String,
    enum: JOB_STATUSES,
    default: 'new'
  },
  // Status history for audit trail
  statusHistory: [{
    status: { type: String },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    notes: { type: String, default: '' }
  }],
  // Estimation (parts + labor)
  estimation: {
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
    subtotal: { type: Number, default: 0 },
    taxRate: { type: Number, default: 18 },
    taxAmount: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    approvedByCustomer: { type: Boolean, default: false },
    approvedAt: { type: Date, default: null },
    sentAt: { type: Date, default: null }
  },
  // Odometer at intake
  odometerAtIntake: {
    type: Number,
    required: [true, 'Odometer reading is required']
  },
  // Expected & actual dates
  expectedDeliveryDate: {
    type: Date,
    default: null
  },
  actualDeliveryDate: {
    type: Date,
    default: null
  },
  // Internal notes
  internalNotes: {
    type: String,
    default: ''
  },
  // Reference to generated invoice
  invoice: {
    type: Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Token used in the customer-facing estimation approval link
  estimationToken: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Auto-generate job card number (only on creation)
jobCardSchema.pre('validate', async function (this: IJobCard) {
  if (this.isNew && !this.jobCardNumber) {
    const count = await mongoose.model('JobCard').countDocuments({ garage: this.garage });
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    this.jobCardNumber = `JC-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  }
});

// Compound unique: same jobCardNumber allowed across garages, unique within a garage
jobCardSchema.index({ garage: 1, jobCardNumber: 1 }, { unique: true });
jobCardSchema.index({ garage: 1, status: 1 });
jobCardSchema.index({ garage: 1, createdAt: -1 });
jobCardSchema.index({ assignedMechanic: 1, status: 1 });

export default mongoose.model<IJobCard>('JobCard', jobCardSchema);
