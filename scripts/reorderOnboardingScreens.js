// scripts/reorderOnboardingScreens.js
//
// Moves the MEAL_TIMING and NOTIFICATION_PERMISSION questions to sit
// immediately after the dietary-preference question (vegetarian / non-
// vegetarian). The rest of the onboarding flow keeps its existing order.
//
// Usage:
//   node scripts/reorderOnboardingScreens.js            # dry-run (default)
//   node scripts/reorderOnboardingScreens.js --apply    # write changes
//
// The sequence field on Question is unique, so the write phase runs in two
// passes: first shift every affected doc to a large temporary sequence
// (current + 100000) to avoid collisions, then write the final sequences.

const mongoose = require('mongoose');
require('dotenv').config();

const Question = require('../models/schemas/Question');

const DIETARY_KEYWORDS = ['vegetarian', 'non-veg', 'non veg'];
const TEMP_OFFSET = 100000;

function matchesDietary(q) {
  const type = (q.type || '').toUpperCase();
  if (type !== 'SELECT' && type !== 'MULTISELECT') return false;
  const text = (q.text || '').toLowerCase();
  if (text.includes('diet')) return true;
  const options = Array.isArray(q.options) ? q.options : [];
  return options.some((opt) => {
    const optText = (opt && (opt.text || opt.value) || '').toLowerCase();
    return DIETARY_KEYWORDS.some((kw) => optText.includes(kw));
  });
}

function summarize(q, idx) {
  const seq = String(q.sequence).padStart(3, ' ');
  const type = (q.type || '').padEnd(22, ' ');
  const text = (q.text || '').slice(0, 80);
  return `  ${String(idx + 1).padStart(2, ' ')}. seq ${seq} · ${type} · ${text}`;
}

function buildReorder(questions) {
  const dietaryIdx = questions.findIndex(matchesDietary);
  if (dietaryIdx < 0) {
    throw new Error(
      'Dietary-preference question not found. Aborting — no anchor to sit the ' +
      'meal-reminder / notification questions after.'
    );
  }

  const mealTiming = questions.find((q) => q.type === 'MEAL_TIMING') || null;
  const notification = questions.find((q) => q.type === 'NOTIFICATION_PERMISSION') || null;
  if (!mealTiming && !notification) {
    return { reordered: questions, dietaryIdx, mealTiming, notification, anyChange: false };
  }

  const moved = new Set();
  if (mealTiming) moved.add(String(mealTiming._id));
  if (notification) moved.add(String(notification._id));

  const reordered = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (moved.has(String(q._id))) continue;
    reordered.push(q);
    if (i === dietaryIdx) {
      if (mealTiming) reordered.push(mealTiming);
      if (notification) reordered.push(notification);
    }
  }

  // If the new order is identical to the old order, nothing to apply.
  const anyChange = reordered.some((q, idx) => String(q._id) !== String(questions[idx]._id));
  return { reordered, dietaryIdx, mealTiming, notification, anyChange };
}

async function main() {
  const apply = process.argv.includes('--apply');

  const mongoUri =
    process.env.MONGO_URI_NEW || process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error(
      'No MongoDB URI found. Set MONGO_URI (or MONGO_URI_NEW / MONGODB_URI) in ' +
      'your env before running this script.'
    );
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log(`✓ Connected to MongoDB\n`);

  const questions = await Question.find({ isActive: true })
    .sort({ sequence: 1 })
    .lean();
  console.log(`Loaded ${questions.length} active questions.\n`);

  console.log('─── Current order ─────────────────────────────');
  questions.forEach((q, idx) => console.log(summarize(q, idx)));
  console.log('');

  let plan;
  try {
    plan = buildReorder(questions);
  } catch (err) {
    console.error(`✗ ${err.message}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  const { reordered, dietaryIdx, mealTiming, notification, anyChange } = plan;
  console.log(`Dietary anchor: seq ${questions[dietaryIdx].sequence} — "${questions[dietaryIdx].text}"`);
  console.log(`MEAL_TIMING found: ${mealTiming ? `seq ${mealTiming.sequence} — "${mealTiming.text}"` : 'no'}`);
  console.log(`NOTIFICATION_PERMISSION found: ${notification ? `seq ${notification.sequence} — "${notification.text}"` : 'no'}`);
  console.log('');

  if (!anyChange) {
    console.log('✓ Already in the desired order — no changes needed.');
    await mongoose.disconnect();
    return;
  }

  console.log('─── Proposed order ────────────────────────────');
  reordered.forEach((q, idx) => {
    const newSeq = String(idx + 1).padStart(3, ' ');
    const oldSeq = String(q.sequence).padStart(3, ' ');
    const changed = Number(oldSeq) !== idx + 1;
    const marker = changed ? ' ←' : '';
    console.log(`  ${String(idx + 1).padStart(2, ' ')}. ${oldSeq} → ${newSeq}${marker} · ${(q.type || '').padEnd(22, ' ')} · ${(q.text || '').slice(0, 64)}`);
  });
  console.log('');

  if (!apply) {
    console.log('ℹ Dry-run only. Re-run with --apply to persist the change.');
    await mongoose.disconnect();
    return;
  }

  console.log('─── Applying changes ──────────────────────────');

  // The `sequence` unique index is NOT scoped to active docs. Inactive
  // legacy questions holding sequences in our target range (1..N) would
  // collide with pass 2. Park them at 9000+ before we start. They stay
  // inactive — the onboarding fetch excludes them — this just moves
  // their numerical slot out of the way.
  const targetMax = reordered.length;
  const collidingInactive = await Question.find({
    isActive: false,
    sequence: { $gte: 1, $lte: targetMax },
  })
    .sort({ sequence: 1 })
    .lean();
  if (collidingInactive.length > 0) {
    console.log(`  ℹ Parking ${collidingInactive.length} inactive docs at 9000+ to avoid unique-index collisions`);
    for (const doc of collidingInactive) {
      await Question.updateOne(
        { _id: doc._id },
        { $set: { sequence: 9000 + doc.sequence } }
      );
    }
  }

  // Two-pass write to respect the unique index on `sequence`:
  //   1) bump every active doc into a safe temp range
  //   2) assign the final sequences
  const tempOps = reordered.map((q) => ({
    updateOne: {
      filter: { _id: q._id },
      update: { $set: { sequence: q.sequence + TEMP_OFFSET } },
    },
  }));
  await Question.bulkWrite(tempOps, { ordered: false });
  console.log('  ✓ Pass 1: moved docs to temp sequence range');

  // Pass 2 runs sequentially — ordered writes so the unique-index check
  // sees a consistent intermediate state rather than racing with parallel
  // writes in `ordered: false` mode.
  for (let idx = 0; idx < reordered.length; idx++) {
    const q = reordered[idx];
    await Question.updateOne(
      { _id: q._id },
      { $set: { sequence: idx + 1 } }
    );
  }
  console.log('  ✓ Pass 2: assigned final sequences\n');

  const verified = await Question.find({ isActive: true })
    .sort({ sequence: 1 })
    .lean();
  console.log('─── Verified new order ────────────────────────');
  verified.forEach((q, idx) => console.log(summarize(q, idx)));
  console.log('\n✓ Done.');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('\n✗ Script failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
