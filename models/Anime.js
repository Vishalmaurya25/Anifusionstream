const mongoose = require('mongoose');

const animeSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: true,
    trim: true,
    maxlength: 200,
    index: true // For search performance
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
  // Content type - movie ya series
  type: {
    type: String,
    enum: ['series', 'movie'],
    default: 'series',
    index: true // Filter karne ke liye
  }
}, { timestamps: true });

// Compound index for queries
animeSchema.index({ name: 'text', description: 'text' });
// Type + updatedAt for homepage filtering
animeSchema.index({ type: 1, updatedAt: -1 });

module.exports = mongoose.model('Anime', animeSchema);