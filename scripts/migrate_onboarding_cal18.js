// scripts/migrate_onboarding_cal18.js
//
// Reshapes the onboarding questions for CAL-18:
//   • Q10 (goal selection)   → 4 options with subtitle education + semantic
//     `value` per option. Maintain carries metadata.deprioritized=true.
//   • Q11 (target weight)    → adds skipIf (skip when goal == maintain).
//   • Q12 (encouragement)    → adds skipIf (skip when goal == maintain) since
//     its copy assumes the user has set a target weight.
//   • Q13a sequence 13.3     = NEW loss rate (3 options, skipIf goal != lose)
//   • Q13b sequence 13.5     = NEW gain rate (2 options, skipIf goal != gain)
//   • Q13c sequence 13.7     = NEW recomp expectation INFO_SCREEN
//     (skipIf goal != recomp)
//   • Old free-form rate question, if found by fingerprint, is deactivated.
//
// CAL-9 pinned the goal-type question by MongoDB _id in the Flutter bloc
// (`6908fe66896ccf24778c907d`). We update Q10 in place by _id when present
// to preserve that pin; otherwise we fall back to sequence: 10 and warn so
// the user can update the Flutter pin to match.
//
// Usage:
//   node scripts/migrate_onboarding_cal18.js          # dry-run (default)
//   node scripts/migrate_onboarding_cal18.js --apply  # persist changes
//
// Idempotent: re-running after --apply produces "no change" lines.

const mongoose = require('mongoose');
require('dotenv').config();

const Question = require('../models/schemas/Question');

// CAL-9 pin: lib/blocs/onboarding/onboarding_bloc.dart pins the goal-type
// question to this _id. The migration updates it in place by _id so the
// pin keeps working.
const GOAL_TYPE_PINNED_ID = '6908fe66896ccf24778c907d';

const Q10_GOAL_OPTIONS = [
  {
    text: 'Gain muscle',
    subtext: 'Build size and strength. Includes a calorie surplus and high protein.',
    value: 'gain',
  },
  {
    text: 'Lose fat',
    subtext: 'Reduce body fat with a calorie deficit. Most popular goal.',
    value: 'lose',
  },
  {
    text: 'Build muscle while losing weight',
    subtext: 'No change in weight. Lose fat and build muscle at the same time.',
    value: 'recomp',
  },
  {
    text: 'Maintain',
    subtext: "Stay at your current weight. For users who've reached their goal or just want to track.",
    value: 'maintain',
    metadata: { deprioritized: true },
  },
];

const Q13A_LOSS_OPTIONS = [
  {
    text: 'Gentle',
    subtext: 'Easier to stick with. Protects muscle. Slower visible results.',
    value: 'gentle',
    metadata: { ratePercent: 0.0025, isDefault: false },
  },
  {
    text: 'Steady',
    subtext: 'Recommended. Sustainable balance of speed and adherence.',
    value: 'steady',
    metadata: { ratePercent: 0.005, isDefault: true },
  },
  {
    text: 'Ambitious',
    subtext: 'Fastest option. Higher risk of muscle loss and rebound.',
    value: 'ambitious',
    metadata: { ratePercent: 0.01, isDefault: false },
  },
];

const Q13B_GAIN_OPTIONS = [
  {
    text: 'Steady',
    subtext: 'Recommended. Most of what you gain will be muscle.',
    value: 'steady',
    metadata: { ratePercent: 0.0025, isDefault: true },
  },
  {
    text: 'Aggressive',
    subtext: 'Faster, but expect more fat gain.',
    value: 'aggressive',
    metadata: { ratePercent: 0.005, isDefault: false },
  },
];

const Q13C_RECOMP_INFO = {
  text: "Recomp is the slow path — and that's the point",
  subtext: 'A short read on what to expect.',
  type: 'INFO_SCREEN',
  options: [],
  infoScreen: {
    heading: "Recomp is the slow path — and that's the point",
    body:
      "Recomposition changes your body composition without changing the number on the scale much. It's the slowest path of the four goals, but it's the only one that builds muscle and loses fat without large weight swings.",
    bullets: [
      'Track progress with measurements and progress photos, not just the scale.',
      "You'll typically see noticeable changes after 8–12 weeks.",
      'Best results come from consistent training and high-protein eating.',
    ],
  },
  sequence: 13.7,
  isActive: true,
};

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

// Map of semantic value → display text, derived from Q10_GOAL_OPTIONS so
// the textIn fallback below stays in lockstep with whatever Q10 actually
// renders. Edits to Q10's option text propagate here automatically.
const VALUE_TO_GOAL_TEXT = Object.freeze(
  Q10_GOAL_OPTIONS.reduce((acc, opt) => {
    if (opt.value && opt.text) acc[opt.value] = opt.text;
    return acc;
  }, {})
);

// Build a skipIf rule that hides a question when the user's goal-type
// answer is in the given valueIn list. Includes the matching display
// texts in `textIn` as a fallback for clients that haven't migrated to
// sending semantic values yet.
function buildGoalSkipIf(goalQuestionId, valueIn) {
  const textIn = valueIn.map((v) => VALUE_TO_GOAL_TEXT[v]).filter(Boolean);
  return [
    {
      questionId: goalQuestionId,
      valueIn,
      textIn,
    },
  ];
}

// Heuristic: a doc is plausibly the goal-type question if its options
// include text matching any of the legacy/new goal labels. Cheap guard
// against the sequence:10 fallback overwriting an unrelated question
// (the dev DB was reordered, so blind sequence matching is unsafe).
function looksLikeGoalQuestion(doc) {
  const options = Array.isArray(doc?.options) ? doc.options : [];
  if (options.length < 2) return false;
  const goalRegex = /(lose|gain|maintain|recomp|weight|muscle)/i;
  return options.some((opt) => {
    const text = typeof opt === 'string' ? opt : opt?.text;
    return typeof text === 'string' && goalRegex.test(text);
  });
}

async function findGoalQuestion() {
  // Prefer the pinned _id so the Flutter bloc pin keeps working.
  let q;
  if (mongoose.isValidObjectId(GOAL_TYPE_PINNED_ID)) {
    q = await Question.findById(GOAL_TYPE_PINNED_ID);
  }
  if (q) return { q, foundBy: 'pinned-id' };

  // Fallback by sequence is risky on reordered DBs, so verify by
  // fingerprint before treating the result as the goal question.
  q = await Question.findOne({ sequence: 10 });
  if (q && !looksLikeGoalQuestion(q)) {
    return {
      q: null,
      foundBy: `sequence-10-rejected (doc at seq 10 is "${q.text}" — not goal-shaped)`,
    };
  }
  return { q, foundBy: q ? 'sequence-10' : 'not-found' };
}

// Find a question by text pattern. The dev DB has been reordered (Q10
// sits at seq 9), and falling back to a sequence number can match the
// wrong question entirely (barriers / workouts-per-week instead of
// what we want). If the pattern doesn't match, return null and let
// the caller skip that op.
async function findByText(textPattern, extraFilter = {}) {
  const q = await Question.findOne({
    text: { $regex: textPattern, $options: 'i' },
    ...extraFilter,
  });
  return { q, foundBy: q ? `text=/${textPattern}/i` : 'not-found' };
}

// Run one update op against an optional Mongo session. Same status
// semantics as the inline loop the apply phase used to use.
async function runOp(op, session) {
  const opts = { upsert: op.upsert };
  if (session) opts.session = session;
  const result = await Question.updateOne(op.filter, op.update, opts);
  const status =
    result.upsertedCount > 0
      ? '✓ inserted'
      : result.modifiedCount > 0
      ? '✓ updated'
      : result.matchedCount > 0
      ? '· no change'
      : '✗ no match';
  console.log(`  ${status} — ${op.label}`);
}

// Mongo throws specific error codes when a standalone deployment can't
// run a transaction. Other failures (network, validation) should NOT be
// caught by the standalone-fallback branch.
function isStandaloneTransactionError(err) {
  if (!err) return false;
  if (err.codeName === 'IllegalOperation') return true;
  if (err.code === 20) return true; // legacy IllegalOperation
  const msg = String(err.message || '');
  return /transaction numbers are only allowed|replica set|standalone/i.test(msg);
}

async function migrate({ apply }) {
  console.log(`\n--- CAL-18 onboarding migration (${apply ? 'APPLY' : 'DRY-RUN'}) ---\n`);

  // 1) Find the goal-type question (Q10).
  const { q: goalQ, foundBy } = await findGoalQuestion();
  if (!goalQ) {
    console.error(
      '✗ Goal-type question not found by _id pin or sequence:10. Run the original ' +
      'seed (onboarding_questions_mongodb.js) first, then re-run this migration.'
    );
    process.exit(1);
  }
  console.log(`Q10 (goal type) located via ${foundBy}: _id=${goalQ._id}, seq=${goalQ.sequence}`);
  if (foundBy !== 'pinned-id') {
    console.log(
      `  ⚠ Goal-type _id (${goalQ._id}) does not match the Flutter pin (${GOAL_TYPE_PINNED_ID}).`
    );
    console.log(
      '    The migration will still update this question, but you must update'
    );
    console.log(
      '    `_goalTypeQuestionId` in lib/blocs/onboarding/onboarding_bloc.dart to'
    );
    console.log(
      `    ${goalQ._id} for the bloc pin to keep working.`
    );
  }

  const goalSkipIfMaintainOnly = buildGoalSkipIf(goalQ._id, ['maintain']);
  // Target weight + encouragement skip for both maintain AND recomp:
  // recomp = "no change in weight", so a target weight is redundant and
  // would let the user contradict their own goal (e.g. recomp + 60 kg
  // target while currently 70 kg).
  const goalSkipIfMaintainOrRecomp =
      buildGoalSkipIf(goalQ._id, ['maintain', 'recomp']);
  const goalSkipIfNotLose = buildGoalSkipIf(goalQ._id, ['gain', 'recomp', 'maintain']);
  const goalSkipIfNotGain = buildGoalSkipIf(goalQ._id, ['lose', 'recomp', 'maintain']);
  const goalSkipIfNotRecomp = buildGoalSkipIf(goalQ._id, ['gain', 'lose', 'maintain']);

  // 2) Locate target-weight, encouragement, and rate questions by content
  // pattern (dev DB has been reordered, so sequence numbers drifted).
  // Patterns are tightened so they don't accidentally match neighbouring
  // questions (e.g. "per week" alone matches "How many workouts do you do
  // per week?").
  const { q: targetWeightQ, foundBy: q11By } = await findByText('target weight');
  const { q: encouragementQ, foundBy: q12By } = await findByText('right track');

  // The rate question's text may have been renamed, but its option set is a
  // distinctive fingerprint: kg-string values like "0.1 kg", "0.5 kg", etc.
  // Try a few patterns then fall back to fingerprint match.
  let rateQ = (await findByText('how much weight.*per week')).q;
  let q13By = rateQ ? 'text=/how much weight.*per week/i' : null;
  if (!rateQ) {
    rateQ = (await findByText('change per week')).q;
    if (rateQ) q13By = 'text=/change per week/i';
  }
  if (!rateQ) {
    // Fingerprint: a SELECT/select question with options text matching
    // "0.X kg" (the original seed's options were "0.1 kg"…"0.9 kg").
    rateQ = await Question.findOne({
      type: { $in: ['SELECT', 'select'] },
      'options.text': { $regex: '^0\\.\\d+\\s*kg$', $options: 'i' },
    });
    if (rateQ) q13By = 'fingerprint=options match /0.X kg/';
  }
  if (!rateQ) q13By = 'not-found';
  console.log(
    `Q11 (target weight) located via ${q11By}: ` +
    (targetWeightQ ? `_id=${targetWeightQ._id}, seq=${targetWeightQ.sequence}, "${targetWeightQ.text}"` : 'NOT FOUND — will skip Q11 op')
  );
  console.log(
    `Q12 (encouragement) located via ${q12By}: ` +
    (encouragementQ ? `_id=${encouragementQ._id}, seq=${encouragementQ.sequence}, "${encouragementQ.text}"` : 'NOT FOUND — will skip Q12 op (acceptable; nothing to add skipIf to)')
  );
  console.log(
    `Q13 (weekly rate) located via ${q13By}: ` +
    (rateQ ? `_id=${rateQ._id}, seq=${rateQ.sequence}, "${rateQ.text}"` : 'NOT FOUND — will skip Q13 update; only insert Q13b/Q13c')
  );
  console.log('');

  // 3) Plan all updates. Each entry is { label, filter, update, upsert }.
  const ops = [];

  ops.push({
    label: 'Q10 goal selection — 4 options + value/metadata',
    filter: { _id: goalQ._id },
    update: {
      $set: {
        text: "What's your primary goal?",
        subtext: 'Choose the goal that best describes what you want to achieve.',
        type: 'SELECT',
        options: Q10_GOAL_OPTIONS,
      },
    },
    upsert: false,
  });

  if (targetWeightQ) {
    ops.push({
      label: 'Q11 target weight — skipIf maintain or recomp',
      filter: { _id: targetWeightQ._id },
      update: {
        $set: {
          skipIf: goalSkipIfMaintainOrRecomp,
        },
      },
      upsert: false,
    });
  }

  if (encouragementQ) {
    ops.push({
      label: 'Q12 encouragement — skipIf maintain or recomp (copy assumes a target)',
      filter: { _id: encouragementQ._id },
      update: {
        $set: {
          skipIf: goalSkipIfMaintainOrRecomp,
        },
      },
      upsert: false,
    });
  }

  // Q13a (loss rate) is always inserted/upserted at a stable sequence
  // (13.3) — independent of whatever the dev DB had at the old "weekly
  // rate" slot. If an old rate question is found by fingerprint, we
  // deactivate it so the new flow surfaces only the new presets.
  ops.push({
    label: 'Q13a loss rate — preset options + skipIf non-lose (NEW)',
    filter: { sequence: 13.3 },
    update: {
      $set: {
        text: 'How fast do you want to lose weight?',
        subtext: 'Pick a pace you can stick with.',
        type: 'SELECT',
        options: Q13A_LOSS_OPTIONS,
        skipIf: goalSkipIfNotLose,
        isActive: true,
      },
    },
    upsert: true,
  });

  if (rateQ) {
    ops.push({
      label: `Deactivate old rate question (_id=${rateQ._id}, seq=${rateQ.sequence}, "${rateQ.text}")`,
      filter: { _id: rateQ._id },
      update: {
        $set: {
          isActive: false,
        },
      },
      upsert: false,
    });
  }

  ops.push({
    label: 'Q13b gain rate — preset options + skipIf non-gain (NEW)',
    filter: { sequence: 13.5 },
    update: {
      $set: {
        text: 'How fast do you want to gain weight?',
        subtext: 'Pick a pace you can stick with.',
        type: 'SELECT',
        options: Q13B_GAIN_OPTIONS,
        skipIf: goalSkipIfNotGain,
        isActive: true,
      },
    },
    upsert: true,
  });

  ops.push({
    label: 'Q13c recomp expectation INFO_SCREEN (NEW)',
    filter: { sequence: 13.7 },
    update: {
      $set: {
        ...Q13C_RECOMP_INFO,
        skipIf: goalSkipIfNotRecomp,
      },
    },
    upsert: true,
  });

  // 3) Preview phase — fetch current state, print intended diffs.
  for (const op of ops) {
    const before = await Question.findOne(op.filter).lean();
    if (!before && !op.upsert) {
      console.log(`  ✗ ${op.label}: not found and not insertable — skipping`);
      continue;
    }
    if (!before) {
      console.log(`  + ${op.label}: will INSERT (sequence ${op.filter.sequence})`);
      continue;
    }
    // Compare the fields we'd $set.
    const setFields = op.update.$set;
    const willChange = Object.keys(setFields).some((k) => {
      const a = JSON.stringify(before[k]);
      const b = JSON.stringify(setFields[k]);
      return a !== b;
    });
    console.log(
      willChange
        ? `  · ${op.label}: will update (seq ${before.sequence})`
        : `  · ${op.label}: no change (seq ${before.sequence})`
    );
  }

  if (!apply) {
    console.log('\nℹ Dry-run only. Re-run with --apply to persist.\n');
    return;
  }

  // 4) Apply phase — wrap in a Mongo transaction when the connected
  //    deployment is a replica set (Atlas, prod). On a standalone dev
  //    Mongo, transactions aren't supported; fall back to the unwrapped
  //    loop and warn so the operator knows partial-failure recovery is
  //    "re-run the script."
  console.log('\nApplying...');
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const op of ops) {
        await runOp(op, session);
      }
    });
  } catch (err) {
    // The first op inside `withTransaction` is what raises the
    // standalone-transaction error — at that point Mongo has aborted the
    // (zero-applied) transaction, so the fallback can re-run every op
    // safely. Idempotency comes from each op's filter+$set shape.
    if (isStandaloneTransactionError(err)) {
      console.log(
        '  ℹ Standalone Mongo detected — transactions unavailable. Falling ' +
        'back to non-transactional apply. If this run fails mid-way, re-run ' +
        'the script (ops are idempotent).'
      );
      for (const op of ops) {
        await runOp(op, null);
      }
    } else {
      throw err;
    }
  } finally {
    await session.endSession();
  }

  console.log('\n✓ Migration complete.\n');

  // 5) Verify final state. Q13a is the upserted-by-sequence loss-rate doc
  //    at 13.3 — NOT the deactivated old rate question (rateQ).
  const finalGoal = await Question.findById(goalQ._id).lean();
  const q11 = targetWeightQ ? await Question.findById(targetWeightQ._id).lean() : null;
  const q12 = encouragementQ ? await Question.findById(encouragementQ._id).lean() : null;
  const q13a = await Question.findOne({ sequence: 13.3 }).lean();
  const q13b = await Question.findOne({ sequence: 13.5 }).lean();
  const q13c = await Question.findOne({ sequence: 13.7 }).lean();

  console.log('--- Final state ---');
  console.log(
    `Q10  options: ${finalGoal?.options?.length || 0}, ` +
    `values: ${(finalGoal?.options || []).map((o) => o.value).join(', ')}`
  );
  console.log(`Q11  skipIf rules: ${q11?.skipIf?.length || 0}`);
  console.log(`Q12  skipIf rules: ${q12?.skipIf?.length || 0}`);
  console.log(`Q13a (loss)  options: ${q13a?.options?.length || 0}, skipIf: ${q13a?.skipIf?.length || 0}`);
  console.log(`Q13b (gain)  options: ${q13b?.options?.length || 0}, skipIf: ${q13b?.skipIf?.length || 0}`);
  console.log(`Q13c (recomp) type: ${q13c?.type}, skipIf: ${q13c?.skipIf?.length || 0}`);
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

main().catch(async (err) => {
  console.error('\n✗ Migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
