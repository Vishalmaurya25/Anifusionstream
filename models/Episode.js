const mongoose = require('mongoose');

const episodeSchema = new mongoose.Schema({
  title: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 200 
  },
  videoUrl: { type: String, required: false, maxlength: 500 },
  embedCode: { type: String, required: false, maxlength: 2000 },
  imageUrl: { type: String, maxlength: 500 },
  episodeNumber: { 
    type: Number, 
    required: true,
    min: 1,
    index: true 
  },
  seasonNumber: { 
    type: Number, 
    required: true,
    min: 1,
    index: true 
  },
  anime: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Anime',
    required: true,
    index: true 
  },
  // NEW: Cache anime type for faster queries
  animeType: {
    type: String,
    enum: ['series', 'movie'],
    default: 'series',
    index: true
  },
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

// Prevent duplicate episodes in same season
episodeSchema.index({ anime: 1, seasonNumber: 1, episodeNumber: 1 }, { unique: true });

module.exports = mongoose.model('Episode', episodeSchema);