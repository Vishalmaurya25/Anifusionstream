const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema({
  username: { 
    type: String, 
    required: true, 
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 30,
    lowercase: true,
    index: true 
  },
  password: { 
    type: String, 
    required: true,
    minlength: 60 // bcrypt hash length
  }
}, { timestamps: true });

module.exports = mongoose.model('Admin', adminSchema);