const mongoose = require('mongoose');

const nutritionSchema = new mongoose.Schema({
  calories: {
    llm: Number,
    final: Number
  },
  protein: {
    llm: Number,
    final: Number
  },
  carbs: {
    llm: Number,
    final: Number
  },
  fat: {
    llm: Number,
    final: Number
  },
  fiber: {
    llm: Number,
    final: Number
  }
}, { _id: false });

const quantitySchema = new mongoose.Schema({
  value: Number,
  unit: String,
  normalized: {
    value: Number,
    unit: String
  }
}, { _id: false });

const itemQuantitySchema = new mongoose.Schema({
  llm: quantitySchema,
  final: {
    value: Number,
    unit: String
  }
}, { _id: false });

const itemQuantityAlternateSchema = new mongoose.Schema({
  llm: {
    value: Number,
    unit: String
  },
  final: {
    value: Number,
    unit: String
  }
}, { _id: false });

const itemSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  name: {
    llm: String,
    final: String
  },
  quantity: itemQuantitySchema,
  quantityAlternate: itemQuantityAlternateSchema,
  nutrition: nutritionSchema,
  confidence: Number,
  nutritionSource: {
    type: String,
    enum: ['usda', 'ifct', 'llm_cached', 'llm_fresh', 'recipe', 'db', 'llm_fallback'],
    default: null
  },
  foodItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FoodItem',
    default: null
  },
  recipeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Recipe',
    default: null
  },
  dataSourcePriority: {
    type: Number,
    default: null
  },
  grams: { type: Number, default: null },
  parentDish: { type: String, default: null },
  componentType: { type: String, default: null }, // 'protein' | 'gravy' when set
  proteinForm: { type: String, default: null },
  glycemicIndex: {
    llm: Number
  }
}, { _id: false });

const photoSchema = new mongoose.Schema({
  url: String,
  width: Number,
  height: Number
}, { _id: false });

const mealSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  capturedAt: {
    type: Date,
    required: true,
    index: true
  },
  photos: [photoSchema],
  llmVersion: String,
  llmModel: String,
  name: String,
  totalNutrition: nutritionSchema,
  items: [itemSchema],
  notes: String,
  userApproved: {
    type: Boolean,
    default: false
  },
  inputTokens: {
    type: Number,
    default: null
  },
  outputTokens: {
    type: Number,
    default: null
  },
  deletedAt: {
    type: Date,
    default: null
  },
  source: {
    type: String,
    enum: ['llm', 'cloned'],
    default: 'llm'
  },
  clonedFrom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Meal',
    default: null
  }
}, {
  timestamps: true
});

// Indexes
mealSchema.index({ userId: 1, capturedAt: -1 });
mealSchema.index({ userId: 1, deletedAt: 1 });
mealSchema.index({ 'items.nutritionSource': 1 });
mealSchema.index({ 'items.foodItemId': 1 });

module.exports = mongoose.model('Meal', mealSchema, 'meals'); 