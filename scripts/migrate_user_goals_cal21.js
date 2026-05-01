// scripts/migrate_user_goals_cal21.js
//
// CAL-21: backfills the four new dynamic-goal fields onto every existing
// User document so the post-CAL-21 invariants hold for legacy users.
//
//   goals.goalType     = 'static'
//   goals.intent       = 'static'
//   goals.outcome      = 'static_chosen'
//   goals.baselineGoal = goals.dailyCalories || 2000
//
// Idempotent: filters on `goals.goalType: { $exists: false }`, so re-runs
// after --apply hit zero documents. Mirrors the pattern in
// migrate_onboarding_cal18.js.
//
// Usage:
//   node scripts/migrate_user_goals_cal21.js          # dry-run (default)
//   node scripts/migrate_user_goals_cal21.js --apply  # persist changes

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/schemas/User');

const FILTER = { 'goals.goalType': { $exists: false } };

// Aggregation-pipeline form so `baselineGoal` references the row's own
// `dailyCalories`. $ifNull falls back to 2000 (the schema default for
// dailyCalories) when a doc somehow lacks the field — matches the value
// new users would get from the schema default.
const UPDATE_PIPELINE = [
  {
    $set: {
      'goals.goalType': 'static',
      'goals.intent': 'static',
      'goals.outcome': 'static_chosen',
      'goals.baselineGoal': { $ifNull: ['$goals.dailyCalories', 2000] },
    },
  },
];

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

async function previewSample() {
  const totalUsers = await User.countDocuments({});
  const candidateCount = await User.countDocuments(FILTER);
  console.log(`Users in collection: ${totalUsers}`);
  console.log(`Candidates missing goals.goalType: ${candidateCount}`);

  if (candidateCount === 0) {
    console.log('Nothing to do — all users already migrated.');
    return { candidateCount };
  }

  const sample = await User.find(FILTER)
    .select('_id goals.dailyCalories goals.goalType goals.intent goals.outcome goals.baselineGoal')
    .limit(3)
    .lean();
  console.log(`\nSample of ${sample.length} candidate doc(s) (before):`);
  for (const doc of sample) {
    const dc = doc.goals && doc.goals.dailyCalories;
    console.log(
      `  _id=${doc._id} dailyCalories=${dc !== undefined ? dc : '(unset)'} ` +
      `→ baselineGoal would be ${dc !== undefined ? dc : 2000}`
    );
  }

  return { candidateCount };
}

async function applyUpdate(session) {
  const opts = session ? { session } : {};
  const result = await User.updateMany(FILTER, UPDATE_PIPELINE, opts);
  return result;
}

async function migrate({ apply }) {
  console.log(`\n--- CAL-21 user-goals backfill (${apply ? 'APPLY' : 'DRY-RUN'}) ---\n`);

  const { candidateCount } = await previewSample();

  if (!apply) {
    console.log('\nℹ Dry-run only. Re-run with --apply to persist.\n');
    return;
  }

  if (candidateCount === 0) {
    return;
  }

  // Wrap in a Mongo transaction when the connected deployment is a replica
  // set. On standalone Mongo, transactions aren't supported; fall back to
  // an unwrapped updateMany. The op is idempotent so partial-failure
  // recovery is "re-run the script."
  console.log('\nApplying...');
  const session = await mongoose.startSession();
  let usedTransaction = false;
  let result;
  try {
    await session.withTransaction(async () => {
      usedTransaction = true;
      result = await applyUpdate(session);
    });
  } catch (err) {
    if (!usedTransaction && isStandaloneTransactionError(err)) {
      console.log(
        '  ℹ Standalone Mongo detected — transactions unavailable. Falling ' +
        'back to non-transactional apply. If this run fails mid-way, re-run ' +
        'the script (the filter is idempotent).'
      );
      result = await applyUpdate(null);
    } else {
      throw err;
    }
  } finally {
    await session.endSession();
  }

  console.log(
    `  ✓ matched=${result.matchedCount} modified=${result.modifiedCount}`
  );

  // Verify final state.
  const remaining = await User.countDocuments(FILTER);
  console.log(`\nRemaining users without goals.goalType: ${remaining}`);
  if (remaining !== 0) {
    console.log(
      '  ⚠ Some users still missing goals.goalType. Investigate before re-running.'
    );
  } else {
    console.log('✓ Migration complete.\n');
  }
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
