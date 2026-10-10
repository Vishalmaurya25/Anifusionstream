const mongoose = require('mongoose');

// 1. Server Subdocument Schema
const serverSchema = new mongoose.Schema({
    name: { type: String, default: 'Server 1', maxlength: 50 },
    videoUrl: { type: String, default: '', maxlength: 500 },
    embedCode: { type: String, default: '', maxlength: 2000 },
    type: { type: String, enum: ['direct', 'iframe'], default: 'direct' }
}, { _id: false });

// 2. Main Episode Schema
const episodeSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true,
        maxlength: 200
    },
    // NEW: Stores the custom name for the main server (e.g., "Play", "Main")
    mainServerName: { 
        type: String, 
        default: 'Server 1', 
        maxlength: 50 
    },
    videoUrl: { 
        type: String, 
        required: false, 
        maxlength: 500 
    }, // Main server direct link
    embedCode: { 
        type: String, 
        required: false, 
        maxlength: 2000 
    }, // Main server iframe
    imageUrl: { 
        type: String, 
        maxlength: 500 
    },
    episodeNumber: {
        type: Number,
        required: true,
        min: 1
    },
    seasonNumber: {
        type: Number,
        required: true,
        min: 1
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
    servers: { 
        type: [serverSchema], 
        default: [],
        // Database-level validation to strictly enforce max 13 servers
        validate: [arrayLimit, 'Exceeds the limit of 13 additional servers']
    }
}, { timestamps: true }); // Automatically handles createdAt and updatedAt fields

// Custom validator function for the 13 server array limit
function arrayLimit(val) {
    return val.length <= 13;
}

// =======================
// INDEXES
// =======================

// Prevents duplicate episodes in the same season for the same anime
episodeSchema.index({ anime: 1, seasonNumber: 1, episodeNumber: 1 }, { unique: true });

// Speeds up your "Latest Releases Feed" query (sorting by newest first)
episodeSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Episode', episodeSchema);