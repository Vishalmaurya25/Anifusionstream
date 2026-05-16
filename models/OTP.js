const mongoose = require('mongoose');

const otpSchema = new mongoose.Schema({
  email: { 
    type: String, 
    required: true,
    lowercase: true,
    trim: true,
    index: true 
  },
  otp: { 
    type: String, 
    required: true,
    length: 6 
  },
  type: {
    type: String,
    enum: ['registration', 'reset'],
    default: 'registration',
    index: true
  },
  createdAt: { 
    type: Date, 
    default: Date.now, 
    expires: 300 // OTP expires in 5 minutes
  }
});

// Compound index for faster lookups
otpSchema.index({ email: 1, otp: 1 });

module.exports = mongoose.model('OTP', otpSchema);