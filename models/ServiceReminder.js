const mongoose = require('mongoose');

const serviceReminderSchema = new mongoose.Schema({
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
  jobCard: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JobCard'
  },
  type: {
    type: String,
    enum: ['periodic_service', 'oil_change', 'tire_rotation', 'inspection', 'custom'],
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
    enum: ['pending', 'sent', 'completed', 'dismissed'],
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

module.exports = mongoose.model('ServiceReminder', serviceReminderSchema);
