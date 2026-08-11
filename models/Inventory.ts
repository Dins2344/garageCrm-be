import mongoose, { Document, Schema, Types } from 'mongoose';
import { InventoryCategory, INVENTORY_CATEGORIES } from '../types/domain';

export interface ISupplier {
  name: string;
  phone: string;
  email: string;
}

export interface IInventory extends Document {
  _id: Types.ObjectId;
  partName: string;
  partNumber: string;
  category: InventoryCategory;
  quantity: number;
  threshold: number;
  unitPrice: number;
  sellingPrice: number;
  supplier: ISupplier;
  location: string;
  garage: Types.ObjectId;
  isActive: boolean;
  isLowStock: boolean; // virtual
  createdAt: Date;
  updatedAt: Date;
}

const inventorySchema = new Schema<IInventory>({
  partName: {
    type: String,
    required: [true, 'Part name is required'],
    trim: true
  },
  partNumber: {
    type: String,
    default: '',
    trim: true
  },
  category: {
    type: String,
    enum: INVENTORY_CATEGORIES,
    default: 'other'
  },
  quantity: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Quantity cannot be negative']
  },
  threshold: {
    type: Number,
    default: 5,
    min: 0
  },
  unitPrice: {
    type: Number,
    required: [true, 'Unit price is required'],
    min: 0
  },
  sellingPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  supplier: {
    name: { type: String, default: '' },
    phone: { type: String, default: '' },
    email: { type: String, default: '' }
  },
  location: {
    type: String,
    default: '',
    trim: true
  },
  garage: {
    type: Schema.Types.ObjectId,
    ref: 'Garage',
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Virtual: check if stock is low
inventorySchema.virtual('isLowStock').get(function (this: IInventory) {
  return this.quantity <= this.threshold;
});

inventorySchema.set('toJSON', { virtuals: true });
inventorySchema.set('toObject', { virtuals: true });

inventorySchema.index({ garage: 1, partName: 'text', partNumber: 'text' });
inventorySchema.index({ garage: 1, category: 1 });

export default mongoose.model<IInventory>('Inventory', inventorySchema);
