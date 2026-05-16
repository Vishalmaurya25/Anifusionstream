const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const genreSchema = new Schema({
  name: { 
    type: String, 
    required: true,
    unique: true,
    trim: true,
    maxlength: 50,
    index: true 
  },
  sequence: { 
    type: Number, 
    default: 9999,  // NULL KI JAGAH 9999
    index: true 
  }
}, { timestamps: true });

module.exports = mongoose.models.Genre || mongoose.model('Genre', genreSchema);