const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema({
  anime: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Anime',
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
    index: true
  },
  guestId: {
    type: String,
    index: true,
    default: null
  },
  username: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  guestEmail: {
    type: String,
    trim: true,
    lowercase: true,
    default: '',
    maxlength: 254
  },
  isAdmin: {
    type: Boolean,
    default: false,
    index: true
  },
  content: {
    type: String,
    required: true,
    trim: true,
    minlength: 2,
    maxlength: 500
  },
  parentComment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment',
    default: null,
    index: true
  },
  replies: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Comment'
  }],
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, { timestamps: true });

// Prevent deep nesting issues
commentSchema.index({ anime: 1, parentComment: 1, createdAt: -1 });

// For guest comment limit tracking
commentSchema.index({ anime: 1, guestId: 1, parentComment: 1 });

module.exports = mongoose.model('Comment', commentSchema);