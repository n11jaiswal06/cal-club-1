const mongoose = require('mongoose');

const componentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['protein', 'grain', 'fat', 'vegetable', 'fruit', 'sauce', 'beverage', 'dairy', 'nuts', 'legumes', 'other'],
    required: true
  },
  gramsPerServing: {
    type: Number,
    required: true
  }
}, { _id: false });

const recipeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    index: true
  },
  aliases: {
    type: [String],
    default: []
  },
  servingUnit: {
    type: String,
    enum: ['bowl', 'plate', 'cup', 'piece', 'serving'],
    required: true
  },
  components: {
    type: [componentSchema],
    required: true
  },
  verified: {
    type: Boolean,
    default: false
  },
  source: {
    type: String,
    enum: ['IFCT', 'MANUAL', 'USER_SUBMITTED'],
    default: 'MANUAL'
  }
}, {
  timestamps: true
});

// Text index for searching recipes
recipeSchema.index({ name: 'text', aliases: 'text' });

// Index for finding verified recipes
recipeSchema.index({ verified: 1 });

module.exports = mongoose.model('Recipe', recipeSchema, 'recipes');
