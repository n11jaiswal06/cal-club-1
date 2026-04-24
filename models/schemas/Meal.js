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

// displayQuantity: user-friendly quantity shown in UI (e.g. "2 rotis", "1 small bowl")
const displayQuantitySchema = new mongoose.Schema({
  llm: {
    value: Number,
    unit: String
  },
  final: {
    value: Number,
    unit: String
  }
}, { _id: false });

// measureQuantity: actual weight/volume used for nutrition calculations (e.g. "150 g", "250 ml")
const measureQuantitySchema = new mongoose.Schema({
  llm: {
    value: Number,
    unit: { type: String, enum: ['g', 'ml'], default: 'g' }
  },
  final: {
    value: Number,
    unit: { type: String, enum: ['g', 'ml'], default: 'g' }
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
  displayQuantity: displayQuantitySchema,
  measureQuantity: measureQuantitySchema,
  nutrition: nutritionSchema,
  confidence: Number,
  nutritionSource: {
    type: String,
    enum: ['usda', 'ifct', 'llm_cached', 'llm_fresh', 'recipe', 'db', 'llm_fallback', 'llm_fresh_needed', 'missing'],
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
  parentDish: { type: String, default: null },
  componentType: { type: String, default: null }, // 'protein' | 'gravy' when set
  proteinForm: { type: String, default: null },
  glycemicIndex: {
    llm: Number
  },
  // Whether the user flagged this as a "main dish" on add/edit. Informs
  // optional downstream meal-title regeneration and analytics. Nullable —
  // legacy items pre-Stage 3 have no value.
  isMain: { type: Boolean, default: null }
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
  tokens: {
    step1: { input: { type: Number, default: null }, output: { type: Number, default: null } },
    decomposition: { input: { type: Number, default: null }, output: { type: Number, default: null } },
    batchNutrition: { input: { type: Number, default: null }, output: { type: Number, default: null } },
    total: { input: { type: Number, default: null }, output: { type: Number, default: null } }
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
  },
  pendingMealId: {
    type: String,
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
// Idempotency: one ACTIVE meal per (userId, pendingMealId) so retries don't
// double-log. Soft-deleted meals drop out of the partial filter so a user
// who deletes a meal and retries with the same pendingMealId can re-analyze
// without hitting E11000 on the index.
mealSchema.index(
  { userId: 1, pendingMealId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      pendingMealId: { $type: 'string' },
      deletedAt: null
    }
  }
);

module.exports = mongoose.model('Meal', mealSchema, 'meals'); 