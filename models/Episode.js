const mongoose = require('mongoose');

const serverSchema = new mongoose.Schema({
    name: { type: String, default: 'Server 1', maxlength: 50 },
    videoUrl: { type: String, default: '', maxlength: 500 },
    embedCode: { type: String, default: '', maxlength: 2000 },
    type: { type: String, enum: ['direct', 'iframe'], default: 'direct' }
}, { _id: false });

const episodeSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  videoUrl: { type: String, required: false, maxlength: 500 }, // Main server
  embedCode: { type: String, required: false, maxlength: 2000 }, // Main server
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
  animeType: {
    type: String,
    enum: ['series', 'movie'],
    default: 'series',
    index: true
  },
  servers: { type: [serverSchema], default: [] }, // NEW: Max 13 additional servers
  createdAt: { type: Date, default: Date.now, index: true }
}, { timestamps: true });

episodeSchema.index({ anime: 1, seasonNumber: 1, episodeNumber: 1 }, { unique: true });

module.exports = mongoose.model('Episode', episodeSchema);