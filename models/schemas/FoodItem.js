const mongoose = require('mongoose');

const foodItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    index: true
  },
  aliases: {
    type: [String],
    default: [],
    index: true
  },
  category: {
    type: String,
    enum: ['protein', 'grain', 'fat', 'vegetable', 'fruit', 'sauce', 'beverage', 'dairy', 'nuts', 'legumes', 'other'],
    required: true
  },
  dataSource: {
    type: String,
    enum: ['USDA', 'IFCT', 'LLM', 'MANUAL'],
    required: true,
    index: true
  },
  sourceId: {
    type: String,
    index: true
  },
  verified: {
    type: Boolean,
    default: false,
    index: true
  },
  // Nutrition per 100g (unified storage for all food types)
  caloriesPer100g: {
    type: Number,
    required: true
  },
  proteinPer100g: {
    type: Number,
    required: true
  },
  carbsPer100g: {
    type: Number,
    required: true
  },
  fatPer100g: {
    type: Number,
    required: true
  },
  fiberPer100g: {
    type: Number,
    default: 0
  },
  // Tracking and metadata
  usageCount: {
    type: Number,
    default: 0
  },
  llmModel: {
    type: String,
    default: null
  },
  llmGeneratedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Text index for fuzzy searching
foodItemSchema.index({ name: 'text', aliases: 'text' });

// Compound index for filtering verified entries by data source
foodItemSchema.index({ dataSource: 1, verified: 1 });

// Index for finding popular items
foodItemSchema.index({ usageCount: -1 });

module.exports = mongoose.model('FoodItem', foodItemSchema, 'food_items');
