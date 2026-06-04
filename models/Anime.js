const mongoose = require('mongoose');

const animeSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 200,
    index: true 
  },
  imageUrl: { type: String, maxlength: 500 },
  description: { type: String, maxlength: 5000 },
  specialInfo: { type: String, default: '', maxlength: 500 },
  genres: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Genre',
    index: true 
  }],
  seasons: [{
    seasonNumber: { type: Number, required: true, min: 1 },
    episodes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Episode' }]
  }],
  type: {
    type: String,
    enum: ['series', 'movie'],
    default: 'series',
    index: true 
  }
}, { timestamps: true });

// Existing indexes
animeSchema.index({ name: 'text', description: 'text' });
animeSchema.index({ type: 1, updatedAt: -1 });

// NEW: Compound indexes for ultra-fast sorting and lazy loading
animeSchema.index({ genres: 1, updatedAt: -1 }); // Fast horizontal row fetching
animeSchema.index({ name: 1, type: 1 }); // Fast search suggestions

module.exports = mongoose.model('Anime', animeSchema);