const mongoose = require('mongoose');

const inventorySchema = new mongoose.Schema({
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
    enum: [
      'engine_oil',
      'filters',
      'brakes',
      'electrical',
      'suspension',
      'body_parts',
      'tyres',
      'battery',
      'coolant',
      'transmission',
      'accessories',
      'other'
    ],
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
    type: mongoose.Schema.Types.ObjectId,
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
inventorySchema.virtual('isLowStock').get(function () {
  return this.quantity <= this.threshold;
});

inventorySchema.set('toJSON', { virtuals: true });
inventorySchema.set('toObject', { virtuals: true });

inventorySchema.index({ garage: 1, partName: 'text', partNumber: 'text' });
inventorySchema.index({ garage: 1, category: 1 });

module.exports = mongoose.model('Inventory', inventorySchema);
