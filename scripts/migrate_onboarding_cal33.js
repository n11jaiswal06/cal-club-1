// scripts/migrate_onboarding_cal33.js
//
// CAL-33: seed `validation` payload on the target-weight question so the
// PICKER's bounds + cross-field rule + helper copy live with the rest of
// the onboarding seed (server-driven). The validator at
// services/targetWeightValidator.js reads this payload at submit time;
// the Flutter onboarding bloc reads it at render time to disable
// out-of-direction PICKER values pre-tap.
//
// Lookup ladder for the target-weight question (most-stable first):
//   1. slug='target_weight' (CAL-30 canonical identity, set by
//      scripts/backfill_question_slugs.js).
//   2. pinned _id '6908fe66896ccf24778c907f' (long-lived envs minted with
//      the canonical hex).
//   3. text fingerprint /target weight/i with sole-match guard.
//
// Idempotent: re-running after --apply produces "no change" lines.
//
// Usage:
//   node scripts/migrate_onboarding_cal33.js          # dry-run (default)
//   node scripts/migrate_onboarding_cal33.js --apply  # persist changes

const mongoose = require('mongoose');
require('dotenv').config();

const Question = require('../models/schemas/Question');

const TARGET_WEIGHT_PINNED_ID = '6908fe66896ccf24778c907f';

// Numbers chosen for sanity, not a clinical recommendation:
//   • minValue/maxValue mirror the existing User.goals.targetWeight bounds
//     (0..500) but tightened to plausible adult human values.
//   • minDeltaKg blocks "currentWeight ± 0.1 kg" picks per CAL-33 scope.
//     0.5 kg is the granularity of the existing weight picker.
const TARGET_WEIGHT_VALIDATION = Object.freeze({
  minValue: 30,
  maxValue: 250,
  requireGoalDirection: {
    goalQuestionSlug: 'goal_type',
    currentWeightQuestionSlug: 'height_weight',
    minDeltaKg: 0.5
  },
  copy: {
    outOfRange: 'Pick a target weight between {min} and {max} kg.',
    invalidForLose: "To lose fat, pick a target lower than your current weight.",
    invalidForGain: 'To gain muscle, pick a target higher than your current weight.',
    invalidForNonDirectional: "Target weight isn't used for this goal.",
    minDelta: 'Pick a target at least {minDelta} kg away from your current weight.',
    missingCurrentWeight: 'Add your current weight before setting a target.',
    missingGoal: 'Pick a goal before setting a target weight.'
  }
});

function getMongoUri() {
  const uri =
    process.env.MONGO_URI_NEW ||
    process.env.MONGO_URI ||
    process.env.MONGODB_URI;
  if (!uri) {
    console.error(
      'No MongoDB URI found. Set MONGO_URI_NEW (or MONGO_URI / MONGODB_URI) in your env.'
    );
    process.exit(1);
  }
  return uri;
}

async function findTargetWeightQuestion() {
  let q = await Question.findOne({ slug: 'target_weight', isActive: true });
  if (q) return { q, foundBy: 'slug=target_weight' };

  if (mongoose.isValidObjectId(TARGET_WEIGHT_PINNED_ID)) {
    q = await Question.findById(TARGET_WEIGHT_PINNED_ID);
    if (q) return { q, foundBy: 'pinned-id' };
  }

  const matches = await Question.find({
    isActive: true,
    text: { $regex: 'target weight', $options: 'i' }
  }).lean();
  if (matches.length === 1) return { q: matches[0], foundBy: 'text-fingerprint' };
  if (matches.length > 1) {
    return {
      q: null,
      foundBy: `ambiguous-text (${matches.length} candidates: ${matches.map(m => m._id).join(', ')})`
    };
  }

  return { q: null, foundBy: 'not-found' };
}

function isStandaloneTransactionError(err) {
  if (!err) return false;
  if (err.codeName === 'IllegalOperation') return true;
  if (err.code === 20) return true;
  const msg = String(err.message || '');
  return /transaction numbers are only allowed|replica set|standalone/i.test(msg);
}

async function runOp(op, session) {
  const opts = { upsert: false };
  if (session) opts.session = session;
  const result = await Question.updateOne(op.filter, op.update, opts);
  const status =
    result.modifiedCount > 0
      ? '✓ updated'
      : result.matchedCount > 0
      ? '· no change'
      : '✗ no match';
  console.log(`  ${status} — ${op.label}`);
}

async function migrate({ apply }) {
  console.log(`\n--- CAL-33 onboarding migration (${apply ? 'APPLY' : 'DRY-RUN'}) ---\n`);

  const { q: targetQ, foundBy } = await findTargetWeightQuestion();
  if (!targetQ) {
    throw new Error(
      'Target-weight question not found by slug, _id pin, or text fingerprint. ' +
      'Run scripts/backfill_question_slugs.js, then re-run this migration. ' +
      `(Lookup result: ${foundBy})`
    );
  }
  console.log(`target_weight question located via ${foundBy}: _id=${targetQ._id}, seq=${targetQ.sequence}`);

  const ops = [{
    label: 'target_weight — validation payload (bounds + goal-direction rule + copy)',
    filter: { _id: targetQ._id },
    update: { $set: { validation: TARGET_WEIGHT_VALIDATION } }
  }];

  // Preview phase
  for (const op of ops) {
    const before = await Question.findOne(op.filter).lean();
    const a = JSON.stringify(before?.validation || null);
    const b = JSON.stringify(op.update.$set.validation);
    console.log(a === b ? `  · ${op.label}: no change` : `  · ${op.label}: will update`);
  }

  if (!apply) {
    console.log('\nℹ Dry-run only. Re-run with --apply to persist.\n');
    return;
  }

  console.log('\nApplying...');
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const op of ops) await runOp(op, session);
    });
  } catch (err) {
    if (isStandaloneTransactionError(err)) {
      console.log(
        '  ℹ Standalone Mongo detected — transactions unavailable. Falling ' +
        'back to non-transactional apply. If this run fails mid-way, re-run ' +
        'the script (ops are idempotent).'
      );
      for (const op of ops) await runOp(op, null);
    } else {
      throw err;
    }
  } finally {
    await session.endSession();
  }

  const after = await Question.findById(targetQ._id).lean();
  console.log(`\n✓ Migration complete. validation set: ${JSON.stringify(after.validation)}\n`);
}

async function main() {
  const apply = process.argv.includes('--apply');
  await mongoose.connect(getMongoUri());
  console.log('✓ Connected to MongoDB');
  try {
    await migrate({ apply });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('\n✗ Migration failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  TARGET_WEIGHT_PINNED_ID,
  TARGET_WEIGHT_VALIDATION,
  findTargetWeightQuestion,
  migrate
};
