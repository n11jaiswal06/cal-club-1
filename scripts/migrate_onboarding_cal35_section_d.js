// scripts/migrate_onboarding_cal35_section_d.js
//
// CAL-35 Section D — onboarding flow sequencing refinements.
//
//   • Q3 (typical activity level) → move sequence 3 → 14.2 and add a
//     skipIf rule on the Dynamic-vs-Static choice question (14.1) so
//     Dynamic users skip it. Dynamic baseline = BMR × 1.2 always — the
//     activity_level band only matters for static-path users (Static-by-
//     choice / permission-denied / sync-failed fallback).
//   • Q15 (NOTIFICATION_PERMISSION) → move sequence 15 → 14.05 so the
//     "we'll remind you at these times" ask sits immediately after the
//     MEAL_TIMING question (seq 14), making the notification CTA feel
//     earned. The dynamic-goal flow (14.1 / 14.3 / 14.5) then runs after
//     notification permission is decided.
//
// Both ops mirror the CAL-35 PR1 migration's pattern: filter by stable
// `_id`, $set the new sequence (and skipIf where applicable), fingerprint
// guard against reordered DBs. Re-runs after --apply are idempotent.
//
// Items 3 (drop DOB from PLAN_CREATION) and 4 (FE-evaluated conditional
// skip on permission state) from CAL-35 Section D are NOT included in
// this PR:
//   - Item 3 needs `User.dateOfBirth` on the User schema before we can
//     skip the DOB question safely; the field doesn't exist today and
//     adding it + backfilling from existing UserQuestion records is a
//     scope expansion beyond pure sequencing.
//   - Item 4 needs CAL-26's permission-state plumbing on the Flutter
//     side before there's anything to evaluate. Will land alongside CAL-26.
//
// Usage:
//   node scripts/migrate_onboarding_cal35_section_d.js          # dry-run (default)
//   node scripts/migrate_onboarding_cal35_section_d.js --apply  # persist changes

const mongoose = require('mongoose');
require('dotenv').config();

const Question = require('../models/schemas/Question');

// Stable IDs (verified live):
//   Q3  6908fe66896ccf24778c9077  "What's your typical activity level?" (CAL-35 PR1 rewrite)
//   Q15 6908fe66896ccf24778c9088  "Let us help you hit your goals" (NOTIFICATION_PERMISSION)
// Choice question (CAL-24, target of skipIf rule):
//   14.1 69f43ca240000000000000a1  "How would you like your daily goal to work?"
const TYPICAL_ACTIVITY_ID = '6908fe66896ccf24778c9077';
const NOTIFICATION_PERMISSION_ID = '6908fe66896ccf24778c9088';
const CAL24_CHOICE_ID = '69f43ca240000000000000a1';

const NEW_TYPICAL_ACTIVITY_SEQUENCE = 14.2;
const NEW_NOTIFICATION_PERMISSION_SEQUENCE = 14.05;

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

// Build a skipIf rule that hides a question when the choice answer is in
// the given valueIn list. Mirrors buildChoiceSkipIf in
// migrate_onboarding_cal24.js — kept local rather than imported to keep
// each migration script self-contained.
function buildChoiceSkipIf(valueIn) {
  // textIn matches the option's display text from the CAL-24 seed.
  // Hardcoded here so the migration doesn't depend on requiring CAL-24's
  // CHOICE_OPTIONS at runtime.
  const valueToText = { dynamic: 'Dynamic', static: 'Static' };
  const textIn = valueIn.map((v) => valueToText[v]).filter(Boolean);
  return [
    {
      questionId: new mongoose.Types.ObjectId(CAL24_CHOICE_ID),
      valueIn,
      textIn,
    },
  ];
}

// Exported for tests so they can inspect the planned ops without a Mongo
// connection. Pure data — no side effects.
function buildOps() {
  return [
    {
      label:
        'Q3 (typical activity level) — move to seq 14.2 + skipIf dynamic (CAL-35 D.1)',
      filter: { _id: new mongoose.Types.ObjectId(TYPICAL_ACTIVITY_ID) },
      update: {
        $set: {
          sequence: NEW_TYPICAL_ACTIVITY_SEQUENCE,
          skipIf: buildChoiceSkipIf(['dynamic']),
        },
      },
      upsert: false,
      // Pre-PR2 sequence: 3. Post-PR2: 14.2. Both states share the same
      // `text` (CAL-35 PR1 already rewrote it to "typical activity level"),
      // so the fingerprint matches /typical activity/i regardless of when
      // the migration is re-run.
      fingerprint: (doc) =>
        typeof doc?.text === 'string' && /typical activity/i.test(doc.text),
    },
    {
      label:
        'Q15 (notification permission) — move to seq 14.05 (CAL-35 D.2)',
      filter: { _id: new mongoose.Types.ObjectId(NOTIFICATION_PERMISSION_ID) },
      update: {
        $set: { sequence: NEW_NOTIFICATION_PERMISSION_SEQUENCE },
      },
      upsert: false,
      // Type is the most stable signal here — copy may evolve, but the
      // question's role (system notification permission ask) is what we
      // care about. Match either type or text for safety.
      fingerprint: (doc) =>
        doc?.type === 'NOTIFICATION_PERMISSION' ||
        (typeof doc?.text === 'string' && /hit your goals/i.test(doc.text)),
    },
  ];
}

async function migrate({ apply }) {
  console.log(
    `\n--- CAL-35 Section D onboarding migration (${apply ? 'APPLY' : 'DRY-RUN'}) ---\n`
  );

  const ops = buildOps();
  const plannedOps = [];

  // 1) Preview phase — fetch current state, verify fingerprint, print
  //    intended diffs. Ops whose fingerprint fails are dropped from the
  //    plan with a warning so the apply phase doesn't touch them.
  for (const op of ops) {
    const before = await Question.findOne(op.filter).lean();
    if (!before && !op.upsert) {
      console.log(`  ✗ ${op.label}: not found and not insertable — skipping`);
      continue;
    }
    if (!before) {
      console.log(`  + ${op.label}: will INSERT`);
      plannedOps.push(op);
      continue;
    }
    if (op.fingerprint && !op.fingerprint(before)) {
      console.log(
        `  ⚠ ${op.label}: fingerprint mismatch at _id ${before._id} ` +
          `(text: "${before.text}", type: "${before.type}") — refusing to update.`
      );
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
        ? `  · ${op.label}: will update (currently seq ${before.sequence})`
        : `  · ${op.label}: no change (already at seq ${before.sequence})`
    );
    plannedOps.push(op);
  }

  if (!apply) {
    console.log('\nℹ Dry-run only. Re-run with --apply to persist.\n');
    return;
  }

  if (plannedOps.length === 0) {
    console.log(
      '\n✗ No ops survived fingerprint checks. Nothing to apply. Aborting.\n'
    );
    return;
  }

  // 2) Apply phase — wrapped in a transaction on replica sets, falls back to
  // a non-transactional loop on standalone dev Mongo.
  console.log('\nApplying...');
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const op of plannedOps) {
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
      for (const op of plannedOps) {
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
  const q3 = await Question.findById(TYPICAL_ACTIVITY_ID).lean();
  const q15 = await Question.findById(NOTIFICATION_PERMISSION_ID).lean();

  console.log('--- Final state ---');
  console.log(
    `Typical activity (was seq 3) → seq ${q3?.sequence ?? 'MISSING'}, ` +
      `skipIf: ${(q3?.skipIf || []).map((r) => `valueIn=${JSON.stringify(r.valueIn)}`).join(' OR ') || 'none'}`
  );
  console.log(
    `Notification permission (was seq 15) → seq ${q15?.sequence ?? 'MISSING'}`
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
  TYPICAL_ACTIVITY_ID,
  NOTIFICATION_PERMISSION_ID,
  CAL24_CHOICE_ID,
  NEW_TYPICAL_ACTIVITY_SEQUENCE,
  NEW_NOTIFICATION_PERMISSION_SEQUENCE,
  buildOps,
  buildChoiceSkipIf,
};
