const mongoose = require('mongoose');

// Typed metadata payload for a Question option. Defined fields are the
// only known consumers today; new metadata shapes belong on this schema
// rather than as bare Mixed keys, so typos (e.g. `deprioritised`) and
// shape drift get caught at write time rather than discovered in the UI.
//
// strict:false is intentional — additive forward-compatibility for
// experiments (a future option might carry `displayHint`, etc.) — but
// the canonical fields above are tracked normally so doc.save() picks
// up changes without `markModified` gymnastics.
const optionMetadataSchema = new mongoose.Schema({
  // Render this option with a less prominent visual treatment. Used on
  // Q10's "Maintain" option per PRD §6.1.
  deprioritized: {
    type: Boolean
  },
  // Body-weight fraction for rate-preset options (e.g. 0.005 == 0.5%/wk).
  // Clients multiply by current weight to compute the kg/wk display.
  ratePercent: {
    type: Number
  },
  // True for the option that should be pre-selected on the screen.
  isDefault: {
    type: Boolean
  }
}, { _id: false, strict: false });

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
  metadata: optionMetadataSchema
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
