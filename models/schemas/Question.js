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

// CAL-24: structured payload for the Dynamic-vs-Static choice screen.
// The four numeric values are fetched at render time from
// POST /goals/choice-preview (see goalController.choicePreview); the seed
// only carries the labels, the "recommended" tag, and the disclosure copy
// from PRD §6.4. `options` follows optionSchema so the FE can keep its
// existing select-style answer wiring (semantic value: 'dynamic' or 'static').
const choicePreviewSchema = new mongoose.Schema({
  endpoint: {
    type: String,
    trim: true,
    default: '/goals/choice-preview'
  },
  staticLabel: { type: String, trim: true },
  dynamicRestLabel: { type: String, trim: true },
  dynamicActiveLabel: { type: String, trim: true },
  dynamicWorkoutLabel: { type: String, trim: true },
  recommendedValue: {
    type: String,
    trim: true,
    enum: ['dynamic', 'static']
  },
  recommendedBadgeText: { type: String, trim: true },
  disclosureHeading: { type: String, trim: true },
  disclosureBody: { type: String, trim: true }
}, { _id: false });

// CAL-24: priming screen shown before invoking the system health-permission
// sheet. Narrow-scope copy lives here; the actual permission request is
// triggered by the FE on CTA press. `secondaryCtaText` lets the user opt
// out before the system sheet appears; the FE chooses which `outcome`
// enum to persist for that path (see CAL-26).
const healthPermissionPrimingSchema = new mongoose.Schema({
  heading: { type: String, trim: true },
  body: { type: String, trim: true },
  bullets: [{ type: String, trim: true }],
  ctaText: { type: String, trim: true },
  secondaryCtaText: { type: String, trim: true }
}, { _id: false });

// CAL-24: per-state copy block for the data-import status screen. The four
// states correspond 1:1 with the User.goals.outcome enum (PRD §7 import
// lifecycle): 'importing' is transient; 'success' → outcome=dynamic;
// 'permissionDenied' → outcome=static_permission_denied; 'syncFailed' →
// outcome=static_sync_failed. The FE flips between blocks based on the
// real-world health-import lifecycle it observes; the seed never picks
// which block to show.
const dataImportStateCopySchema = new mongoose.Schema({
  heading: { type: String, trim: true },
  body: { type: String, trim: true },
  ctaText: { type: String, trim: true }
}, { _id: false });

const dataImportSchema = new mongoose.Schema({
  importing: dataImportStateCopySchema,
  success: dataImportStateCopySchema,
  permissionDenied: dataImportStateCopySchema,
  syncFailed: dataImportStateCopySchema
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
      // CAL-24: Dynamic Goal onboarding screens. Each carries its own
      // structured payload (choicePreview / healthPermissionPriming /
      // dataImport) so the FE dispatches on type rather than guessing
      // from metadata.
      'CHOICE_PREVIEW',
      'HEALTH_PERMISSION_PRIMING',
      'DATA_IMPORT_STATUS',
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
  // CAL-24 sub-schemas — populated only on the matching `type`.
  choicePreview: choicePreviewSchema,
  healthPermissionPriming: healthPermissionPrimingSchema,
  dataImport: dataImportSchema,
  skipIf: [skipIfSchema],
  sequence: {
    type: Number,
    required: true,
    unique: true,
    min: 1
  },
  // CAL-30: stable, content-derived identity for canonical onboarding
  // questions (e.g. 'goal_type', 'rate_loss'). Backfilled by
  // scripts/backfill_question_slugs.js using content fingerprints, then
  // owned by the question forever. Migrations and lookup code prefer slug
  // over _id pinning or sequence pinning so fresh deploys / CI / DR
  // restores resolve canonical questions identically to long-lived envs.
  // Optional — only canonical questions get a slug; ad-hoc questions stay
  // sluggless (the sparse index excludes missing values from the
  // uniqueness constraint).
  slug: {
    type: String,
    trim: true,
    lowercase: true,
    match: /^[a-z][a-z0-9_]*$/,
    maxlength: 64
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
questionSchema.index(
  { slug: 1 },
  { unique: true, sparse: true, name: 'slug_unique_sparse' }
);

module.exports = mongoose.model('Question', questionSchema, 'questions');
