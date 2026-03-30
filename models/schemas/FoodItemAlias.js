const mongoose = require('mongoose');

const foodItemAliasSchema = new mongoose.Schema({
  foodItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FoodItem',
    required: true,
    index: true
  },
  alias: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  language: {
    type: String,
    enum: ['en', 'hi', 'ta', 'te', 'ml', 'kn', 'bn', 'other'],
    default: 'en'
  },
  regionality: {
    type: String,
    enum: ['north_indian', 'south_indian', 'east_indian', 'west_indian', 'universal', 'other'],
    default: 'universal'
  },
  source: {
    type: String,
    enum: ['USER', 'MANUAL', 'IFCT'],
    required: true
  },
  usageCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for finding popular aliases
foodItemAliasSchema.index({ usageCount: -1 });

module.exports = mongoose.model('FoodItemAlias', foodItemAliasSchema, 'food_item_aliases');
