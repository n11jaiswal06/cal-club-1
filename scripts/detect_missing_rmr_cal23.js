// scripts/detect_missing_rmr_cal23.js
//
// CAL-23 introduced User.goals.rmr, populated at /goals/calculate-and-save
// time. Existing users on goalType='dynamic' from before this rollout
// have the field unset, which makes /app/progress's dynamicGoal block
// silently absent — the home screen falls back to static rendering.
//
// This script detects affected users so ops can decide remediation:
//   • If the count is zero, no further action.
//   • If non-zero, the affected users need to re-run goal calculation
//     (the in-app re-onboarding sub-flow at PLAN_CREATION). An automated
//     server-side backfill would require parsing demographic answers out
//     of UserQuestion across multiple question shapes (sex / DOB /
//     height+weight composite); deferred as a follow-up if the population
//     warrants it.
//
// Usage:
//   node scripts/detect_missing_rmr_cal23.js          # summary + counts
//   node scripts/detect_missing_rmr_cal23.js --list   # list user _ids + emails
//
// Read-only — never writes. Safe to run on prod.

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/schemas/User');

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

async function detect({ list }) {
  console.log('\n--- CAL-23 missing-rmr detection ---\n');

  // Affected = goalType is dynamic (or intent stayed dynamic on a fallback,
  // which still gets the dynamicGoal block per buildTodaysGoal's gating)
  // AND rmr is missing or non-positive.
  const filter = {
    $and: [
      {
        $or: [
          { 'goals.goalType': 'dynamic' },
          // Permission-denied/sync-failed fallbacks: goalType flipped to
          // static but intent stayed 'dynamic'. These users won't see the
          // dynamicGoal block today (gated on goalType), so they're not
          // affected by the missing-rmr issue. Excluded from the count.
        ]
      },
      {
        $or: [
          { 'goals.rmr': { $exists: false } },
          { 'goals.rmr': null },
          { 'goals.rmr': { $lte: 0 } }
        ]
      }
    ]
  };

  const totalDynamic = await User.countDocuments({ 'goals.goalType': 'dynamic' });
  const affected = await User.countDocuments(filter);

  console.log(`Total users with goalType='dynamic':  ${totalDynamic}`);
  console.log(`...of which missing/zero rmr:         ${affected}`);
  console.log(
    affected === 0
      ? '\n✓ No affected users. No remediation needed.'
      : `\n⚠ ${affected} user(s) will silently see the static UI variant ` +
        `until they re-run /goals/calculate-and-save (in-app re-onboarding ` +
        `via the PLAN_CREATION sub-flow refreshes goals.rmr).`
  );

  if (list && affected > 0) {
    console.log('\n--- Affected users ---');
    const docs = await User.find(filter)
      .select('_id email phone goals.goalType goals.baselineGoal goals.rmr createdAt')
      .lean();
    for (const u of docs) {
      const id = u._id.toString();
      const contact = u.email || u.phone || '(no contact)';
      const baseline = u.goals?.baselineGoal ?? 'unset';
      console.log(
        `  ${id}  ${contact.padEnd(35)} baselineGoal=${baseline}  ` +
        `created=${u.createdAt?.toISOString()?.slice(0, 10) || '?'}`
      );
    }
  } else if (affected > 0) {
    console.log('\nℹ Re-run with --list to see _ids + emails.');
  }

  console.log('');
}

async function main() {
  const list = process.argv.includes('--list');
  await mongoose.connect(getMongoUri());
  console.log('✓ Connected to MongoDB');

  try {
    await detect({ list });
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(async (err) => {
  console.error('\n✗ Detection failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
