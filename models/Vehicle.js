const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
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
    enum: ['petrol', 'diesel', 'cng', 'electric', 'hybrid', 'other'],
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
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  garage: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Garage',
    required: true
  },
  serviceHistory: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'JobCard'
  }]
}, {
  timestamps: true
});

vehicleSchema.index({ garage: 1, licensePlate: 1 }, { unique: true });

module.exports = mongoose.model('Vehicle', vehicleSchema);
