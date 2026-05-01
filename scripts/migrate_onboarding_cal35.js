// scripts/migrate_onboarding_cal35.js
//
// CAL-35: switch the onboarding activity question to the standard PAL bands
// and drop the redundant workouts/week question.
//
//   • Q2 (How many workouts do you do per week?) → isActive: false. The new
//     v2 math (TDEE = RMR × ACTIVITY_MULTIPLIER) bakes typical exercise into
//     the activity-level band, so a separate workouts question would
//     double-count.
//   • Q3 (What's your typical day like?) → rewritten as
//     "What's your typical activity level?" with five lifestyle-shaped
//     options (sedentary / lightly_active / moderately_active / very_active /
//     extra_active). Each option's `value` matches the new
//     ACTIVITY_MULTIPLIERS keys in services/goalService.js.
//
// Self-report-inflation note: literature consensus (Tooze 2007, Schoeller
// 1995) is that users pick one band higher than reality. Subtext leans
// conservative ("If you're between two, lean lower") to nudge toward
// realistic picks.
//
// Both ops are idempotent — Q2 updates by sequence:2, Q3 updates by
// sequence:3. Re-runs after --apply produce "no change" lines.
//
// Usage:
//   node scripts/migrate_onboarding_cal35.js          # dry-run (default)
//   node scripts/migrate_onboarding_cal35.js --apply  # persist changes

const mongoose = require('mongoose');
require('dotenv').config();

const Question = require('../models/schemas/Question');

// PRD §6.4 / CAL-35: standard PAL band options. The `value` matches
// ACTIVITY_MULTIPLIERS keys in goalService.js; the FE may read either
// `value` directly or pattern-match the `text`.
const ACTIVITY_LEVEL_OPTIONS = [
  {
    text: 'Sedentary',
    subtext:
      'Desk job, little or no exercise. You drive most places and rarely break a sweat.',
    value: 'sedentary',
  },
  {
    text: 'Lightly active',
    subtext:
      'Light exercise 1–3 days a week, OR a job with some walking (e.g. teacher, retail).',
    value: 'lightly_active',
  },
  {
    text: 'Moderately active',
    subtext:
      'Exercise 3–5 days a week, OR an active day-to-day (e.g. nurse, server).',
    value: 'moderately_active',
    metadata: { isDefault: true },
  },
  {
    text: 'Very active',
    subtext:
      'Hard exercise 6–7 days a week, OR a physically demanding job.',
    value: 'very_active',
  },
  {
    text: 'Extremely active',
    subtext:
      'Athlete-level training, two-a-days, OR heavy manual labor most days.',
    value: 'extra_active',
  },
];

const ACTIVITY_QUESTION_TEXT = "What's your typical activity level?";
const ACTIVITY_QUESTION_SUBTEXT =
  "Pick the band that best describes a normal week — daily activity AND any exercise. " +
  "If you're between two, lean lower; you can adjust later if results don't match.";

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

function isStandaloneTransactionError(err) {
  if (!err) return false;
  if (err.codeName === 'IllegalOperation') return true;
  if (err.code === 20) return true;
  const msg = String(err.message || '');
  return /transaction numbers are only allowed|replica set|standalone/i.test(
    msg
  );
}

// Exported for tests so they can inspect the planned ops without a Mongo
// connection. Pure data — no side effects.
function buildOps() {
  return [
    {
      label: 'Q2 (workouts/week) — isActive: false (CAL-35 drops this question)',
      filter: { sequence: 2 },
      update: { $set: { isActive: false } },
      upsert: false,
    },
    {
      label:
        "Q3 — rewrite to 'What's your typical activity level?' with 5 PAL bands (CAL-35)",
      filter: { sequence: 3 },
      update: {
        $set: {
          text: ACTIVITY_QUESTION_TEXT,
          subtext: ACTIVITY_QUESTION_SUBTEXT,
          type: 'SELECT',
          options: ACTIVITY_LEVEL_OPTIONS,
          isActive: true,
        },
      },
      upsert: false,
    },
  ];
}

async function migrate({ apply }) {
  console.log(
    `\n--- CAL-35 onboarding migration (${apply ? 'APPLY' : 'DRY-RUN'}) ---\n`
  );

  const ops = buildOps();

  // 1) Preview phase — fetch current state, print intended diffs.
  for (const op of ops) {
    const before = await Question.findOne(op.filter).lean();
    if (!before && !op.upsert) {
      console.log(`  ✗ ${op.label}: not found and not insertable — skipping`);
      continue;
    }
    if (!before) {
      console.log(`  + ${op.label}: will INSERT`);
      continue;
    }
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

  // 2) Apply phase — wrapped in a transaction on replica sets, falls back to
  // a non-transactional loop on standalone dev Mongo.
  console.log('\nApplying...');
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const op of ops) {
        await runOp(op, session);
      }
    });
  } catch (err) {
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

  // 3) Verify final state.
  const q2 = await Question.findOne({ sequence: 2 }).lean();
  const q3 = await Question.findOne({ sequence: 3 }).lean();

  console.log('--- Final state ---');
  console.log(
    `Q2 (workouts/week)  isActive: ${q2?.isActive ?? 'MISSING'}, text: "${q2?.text}"`
  );
  console.log(
    `Q3 (activity level) text: "${q3?.text}", options: ${
      (q3?.options || []).length
    }, values: ${(q3?.options || []).map((o) => o.value).join(', ')}`
  );
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
  ACTIVITY_LEVEL_OPTIONS,
  ACTIVITY_QUESTION_TEXT,
  ACTIVITY_QUESTION_SUBTEXT,
  buildOps,
};
