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
    enum: ['protein', 'grain', 'fat', 'vegetable', 'fruit', 'sauce', 'beverage', 'dairy', 'nuts', 'legumes', 'gravy', 'biryani_rice', 'other'],
    required: true
  },
  itemType: {
    type: String,
    enum: ['single_item', 'composite_dish'],
    default: 'single_item'
  },
  reviewed: {
    type: Boolean,
    default: false
  },
  dataSource: {
    type: String,
    enum: ['USDA', 'IFCT', 'LLM', 'MANUAL', 'INDB_DERIVED'],
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
  // Per-food unit → grams/ml conversions for typeahead and edit flows.
  // source: 'aggregated' (derived from Meal history mode), 'llm' (generated at
  // FoodItem creation or ad-hoc resolution), 'user_confirmed' (reserved).
  servingSizes: {
    type: [
      new mongoose.Schema({
        unit: { type: String, required: true },
        grams: { type: Number, required: true },
        isDefault: { type: Boolean, default: false },
        source: {
          type: String,
          enum: ['aggregated', 'llm', 'user_confirmed'],
          default: 'llm'
        },
        sampleSize: { type: Number, default: null },
        updatedAt: { type: Date, default: Date.now }
      }, { _id: false })
    ],
    default: []
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
  },
  // Embedding fields for semantic search (RAG)
  embedding: {
    type: [Number],
    default: null,
    validate: {
      validator: function(v) {
        return !v || v.length === 768; // 768 dimensions for OpenAI text-embedding-3-small
      },
      message: 'Embedding must be exactly 768 dimensions'
    }
  },
  embeddingModel: {
    type: String,
    default: null
  },
  embeddingGeneratedAt: {
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
