import mongoose, { Document, Schema, Types } from 'mongoose';
import { FuelType, FUEL_TYPES } from '../types/domain';

export interface IVehicle extends Omit<Document, 'model'> {
  _id: Types.ObjectId;
  licensePlate: string;
  make: string;
  model: string;
  year: number | null;
  color: string;
  fuelType: FuelType;
  vin: string;
  engineNumber: string;
  currentOdometerReading: number;
  customer: Types.ObjectId;
  garage: Types.ObjectId;
  serviceHistory: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const vehicleSchema = new Schema<IVehicle>({
  licensePlate: {
    type: String,
    required: [true, 'License plate is required'],
    uppercase: true,
    trim: true
  },
  make: {
    type: String,
    required: [true, 'Vehicle make is required'],
    trim: true
  },
  model: {
    type: String,
    required: [true, 'Vehicle model is required'],
    trim: true
  },
  year: {
    type: Number,
    default: null
  },
  color: {
    type: String,
    default: ''
  },
  fuelType: {
    type: String,
    enum: FUEL_TYPES,
    default: 'petrol'
  },
  vin: {
    type: String,
    default: ''
  },
  engineNumber: {
    type: String,
    default: ''
  },
  currentOdometerReading: {
    type: Number,
    default: 0
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
  serviceHistory: [{
    type: Schema.Types.ObjectId,
    ref: 'JobCard'
  }]
}, {
  timestamps: true
});

vehicleSchema.index({ garage: 1, licensePlate: 1 }, { unique: true });

export default mongoose.model<IVehicle>('Vehicle', vehicleSchema);
