const mongoose = require('mongoose');

const ContactSchema = new mongoose.Schema({
    name: { 
      type: String, 
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50 
    },
    email: { 
      type: String, 
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      index: true 
    },
    subject: { 
        type: String, 
        required: true,
        enum: ['Copyright Complaint', 'Anime Suggestion', 'Dead Link Report', 'Video Quality/Blur Issue', 'Other']
    },
    message: { 
      type: String, 
      required: true,
      trim: true,
      minlength: 10,
      maxlength: 2000 
    },
    ip: { type: String }, // For spam tracking
    isRead: { type: Boolean, default: false, index: true },
    createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

module.exports = mongoose.model('Contact', ContactSchema);