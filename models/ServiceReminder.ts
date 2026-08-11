import mongoose, { Document, Schema, Types } from 'mongoose';
import { ReminderType, REMINDER_TYPES, ReminderStatus, REMINDER_STATUSES } from '../types/domain';

export interface IServiceReminder extends Document {
  _id: Types.ObjectId;
  vehicle: Types.ObjectId;
  customer: Types.ObjectId;
  garage: Types.ObjectId;
  jobCard: Types.ObjectId | null;
  type: ReminderType;
  nextServiceDate: Date;
  nextServiceKm: number;
  notes: string;
  status: ReminderStatus;
  reminderSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const serviceReminderSchema = new Schema<IServiceReminder>({
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
  jobCard: {
    type: Schema.Types.ObjectId,
    ref: 'JobCard'
  },
  type: {
    type: String,
    enum: REMINDER_TYPES,
    default: 'periodic_service'
  },
  nextServiceDate: {
    type: Date,
    required: true
  },
  nextServiceKm: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: REMINDER_STATUSES,
    default: 'pending'
  },
  reminderSentAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

serviceReminderSchema.index({ garage: 1, nextServiceDate: 1 });
serviceReminderSchema.index({ garage: 1, status: 1 });
serviceReminderSchema.index({ vehicle: 1 });

export default mongoose.model<IServiceReminder>('ServiceReminder', serviceReminderSchema);
