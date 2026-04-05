const mongoose = require('mongoose');

const jobCardSchema = new mongoose.Schema({
  jobCardNumber: {
    type: String,
    required: true
  },
  vehicle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  garage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Garage',
    required: true
  },
  // Customer complaints / service requests
  complaints: [{
    description: { type: String, required: true },
    priority: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'medium' }
  }],
  // Vehicle photos (scratches, dents — for liability)
  photos: [{
    url: { type: String },
    caption: { type: String, default: '' },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  // Mechanic assignment
  assignedMechanic: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  assignedAdvisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Job card status flow
  status: {
    type: String,
    enum: [
      'new',
      'estimation_sent',
      'approved',
      'in_progress',
      'quality_check',
      'ready_for_pickup',
      'delivered',
      'cancelled'
    ],
    default: 'new'
  },
  // Status history for audit trail
  statusHistory: [{
    status: { type: String },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    changedAt: { type: Date, default: Date.now },
    notes: { type: String, default: '' }
  }],
  // Estimation (parts + labor)
  estimation: {
    parts: [{
      inventoryItem: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory' },
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
    default: 0
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
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Auto-generate job card number (only on creation)
jobCardSchema.pre('validate', async function () {
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

module.exports = mongoose.model('JobCard', jobCardSchema);
