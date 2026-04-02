const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    required: true
  },
  jobCard: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JobCard',
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  vehicle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vehicle',
    required: true
  },
  garage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Garage',
    required: true
  },
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
    enum: ['unpaid', 'partial', 'paid'],
    default: 'unpaid'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'upi', 'card', 'bank_transfer', 'other', ''],
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
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

// Auto-generate invoice number
invoiceSchema.pre('validate', async function () {
  if (this.isNew && !this.invoiceNumber) {
    const count = await mongoose.model('Invoice').countDocuments({ garage: this.garage });
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    this.invoiceNumber = `INV-${dateStr}-${String(count + 1).padStart(4, '0')}`;
  }
});

invoiceSchema.index({ garage: 1, createdAt: -1 });
invoiceSchema.index({ garage: 1, paymentStatus: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
