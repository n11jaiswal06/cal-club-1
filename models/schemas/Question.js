const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true
  },
  subtext: {
    type: String,
    trim: true
  },
  icon: {
    type: String,
    trim: true
  },
  // Semantic identifier (e.g. "lose", "recomp", "steady"). When present,
  // server logic and client branching match on this rather than display text.
  value: {
    type: String,
    trim: true
  },
  // Free-form per-option metadata. First uses: { deprioritized: true } on
  // Maintain so the client can render it at smaller treatment, and
  // { ratePercent, isDefault } on rate-preset options so the client can
  // compute kg/wk without recomputing semantics.
  metadata: {
    type: mongoose.Schema.Types.Mixed
  }
}, { _id: false });

const imageSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
    trim: true
  },
  paddingHorizontal: {
    type: Number,
    default: 0
  },
  paddingVertical: {
    type: Number,
    default: 0
  },
  height: {
    type: Number
  }
}, { _id: false });

// Structured content for INFO_SCREEN questions (the recomp expectation
// screen, etc.). Kept separate from `text`/`subtext` so the client can
// render headline + body + bullets distinctly without parsing newlines.
const infoScreenSchema = new mongoose.Schema({
  heading: {
    type: String,
    trim: true
  },
  body: {
    type: String,
    trim: true
  },
  bullets: [{
    type: String,
    trim: true
  }]
}, { _id: false });

// One conditional rule that hides this question if the user's previously-
// stored answer to `questionId` matches any value in `valueIn` (semantic) or
// any text in `textIn` (display fallback). Multiple rules combine as OR.
const skipIfSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Question',
    required: true
  },
  valueIn: [{
    type: String,
    trim: true
  }],
  textIn: [{
    type: String,
    trim: true
  }]
}, { _id: false });

const questionSchema = new mongoose.Schema({
  text: {
    type: String,
    required: true,
    trim: true,
    maxlength: 500
  },
  subtext: {
    type: String,
    trim: true,
    maxlength: 1000
  },
  type: {
    type: String,
    required: true,
    enum: [
      'NO_INPUT',
      'NAME_INPUT',
      'SELECT',
      'PICKER',
      'DATE',
      'SUMMARY',
      'SLIDER',
      'REFERRAL_INPUT',
      'PLAN_SUMMARY',
      'MEAL_TIMING',
      'NOTIFICATION_PERMISSION',
      'GOAL_CALCULATION',
      'INFO_SCREEN',
      // Legacy types for backward compatibility
      'text',
      'number',
      'select',
      'multiselect',
      'radio',
      'checkbox',
      'textarea',
      'date',
      'email',
      'phone'
    ],
    default: 'text'
  },
  options: [optionSchema],
  image: imageSchema,
  infoScreen: infoScreenSchema,
  skipIf: [skipIfSchema],
  sequence: {
    type: Number,
    required: true,
    unique: true,
    min: 1
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes
questionSchema.index({ isActive: 1, sequence: 1 });

module.exports = mongoose.model('Question', questionSchema, 'questions');
