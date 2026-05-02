// scripts/migrate_onboarding_cal24.js
//
// Adds the Dynamic Goal onboarding screens for CAL-24:
//   • Q14.1 (CHOICE_PREVIEW)            — Dynamic-vs-Static picker (PRD §6.4)
//   • Q14.3 (HEALTH_PERMISSION_PRIMING) — narrow-scope priming    (PRD §6.5)
//   • Q14.5 (DATA_IMPORT_STATUS)        — 4-state import screen   (PRD §6.6)
//
// Branching: 14.3 and 14.5 both skip when the user picks `static` at 14.1.
// The permission-denied / sync-failed paths are terminal *states inside* 14.5
// — they don't re-route the user (the static lifestyle questions already ran
// before the choice screen) but they drive which `outcome` value the FE sends
// to /goals/calculate-and-save (see goalService.resolveGoalMode).
//
// Each new question is upserted by its pre-minted `_id` so onboardingService's
// planCreationQuestionIds list stays self-consistent without a discovery hop.
//
// Usage:
//   node scripts/migrate_onboarding_cal24.js          # dry-run (default)
//   node scripts/migrate_onboarding_cal24.js --apply  # persist changes
//
// Idempotent: re-running after --apply produces "no change" lines.

const mongoose = require('mongoose');
require('dotenv').config();

const Question = require('../models/schemas/Question');

// Pre-minted ObjectIds for the three CAL-24 questions. Hardcoded here AND in
// services/onboardingService.js (planCreationQuestionIds) — keep both in sync.
const CAL24_CHOICE_ID = '69f43ca240000000000000a1';
const CAL24_PRIMING_ID = '69f43ca240000000000000a3';
const CAL24_IMPORT_ID = '69f43ca240000000000000a5';

// PRD §6.4 — Dynamic vs Static choice screen.
const CHOICE_OPTIONS = [
  {
    text: 'Dynamic',
    subtext:
      "Your goal adjusts to match your activity, so it's more accurate to your day.",
    value: 'dynamic',
  },
  {
    text: 'Static',
    subtext: "Stays the same every day. Won't adapt to your daily activity.",
    value: 'static',
  },
];

const CHOICE_PREVIEW_PAYLOAD = {
  endpoint: '/goals/choice-preview',
  staticLabel: 'Every day:',
  dynamicRestLabel: 'Rest day (~3,000 steps):',
  dynamicActiveLabel: 'Active day (~8,000 steps, no workout):',
  dynamicWorkoutLabel: 'Workout day (~8,000 steps + 30-min workout):',
  recommendedValue: 'dynamic',
  recommendedBadgeText: 'Recommended',
  // The "honest disclosure" line called out in PRD §6.4 — sits on the
  // Dynamic option, distinct from the supporting subtext above.
  disclosureBody:
    'On low-activity days, your goal will be more accurate to your real needs (and may be lower than a fixed daily goal).',
};

// PRD §6.5 — narrow-scope priming before the system permission sheet.
const PRIMING_PAYLOAD = {
  heading: 'Connect your activity data',
  body:
    'To calculate your dynamic goal, Cal Club needs to read your steps and workouts.',
  bullets: [
    'We only read steps and workouts — nothing else.',
    'Your goal adjusts each day based on what you actually do.',
    'You can revoke access anytime in your phone settings.',
  ],
  ctaText: 'Connect',
  secondaryCtaText: 'Use static goal instead',
};

// PRD §6.6 — Data Import screen, 4 lifecycle states.
const DATA_IMPORT_PAYLOAD = {
  importing: {
    heading: 'Importing your activity data…',
    body: "Hang tight — we're pulling in your recent steps and workouts.",
  },
  success: {
    heading: "You're all set",
    body: 'Your dynamic goal is ready.',
    ctaText: 'Continue',
  },
  permissionDenied: {
    heading: "We couldn't access your activity data",
    body: "We'll set up your goal manually for now.",
    ctaText: 'Continue',
  },
  syncFailed: {
    heading: "We couldn't import your activity data right now",
    body: "We'll set up your goal manually for now.",
    ctaText: 'Continue',
  },
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

// Build a skipIf rule that hides a question when the choice answer is in the
// given valueIn list. textIn carries the display fallback for clients that
// haven't migrated to sending semantic values yet.
function buildChoiceSkipIf(valueIn) {
  const valueToText = CHOICE_OPTIONS.reduce((acc, opt) => {
    if (opt.value && opt.text) acc[opt.value] = opt.text;
    return acc;
  }, {});
  const textIn = valueIn.map((v) => valueToText[v]).filter(Boolean);
  return [
    {
      questionId: new mongoose.Types.ObjectId(CAL24_CHOICE_ID),
      valueIn,
      textIn,
    },
  ];
}

// Same status semantics as the CAL-18 migration's runOp.
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

// Exported for tests so they can inspect the planned ops without connecting
// to Mongo. Pure data — no side effects.
function buildOps() {
  const skipIfStatic = buildChoiceSkipIf(['static']);

  return [
    {
      label: 'Q14.1 Dynamic-vs-Static choice screen (NEW, CAL-24)',
      filter: { _id: new mongoose.Types.ObjectId(CAL24_CHOICE_ID) },
      update: {
        $set: {
          text: 'How would you like your daily goal to work?',
          subtext:
            "Your daily calorie goal can stay the same every day, or adjust to match what you actually do.",
          type: 'CHOICE_PREVIEW',
          options: CHOICE_OPTIONS,
          choicePreview: CHOICE_PREVIEW_PAYLOAD,
          sequence: 14.1,
          isActive: true,
        },
      },
      upsert: true,
    },
    {
      label: 'Q14.3 Health-permission priming screen (NEW, CAL-24)',
      filter: { _id: new mongoose.Types.ObjectId(CAL24_PRIMING_ID) },
      update: {
        $set: {
          text: PRIMING_PAYLOAD.heading,
          subtext: PRIMING_PAYLOAD.body,
          type: 'HEALTH_PERMISSION_PRIMING',
          options: [],
          healthPermissionPriming: PRIMING_PAYLOAD,
          skipIf: skipIfStatic,
          sequence: 14.3,
          isActive: true,
        },
      },
      upsert: true,
    },
    {
      label: 'Q14.5 Data-import status screen (NEW, CAL-24)',
      filter: { _id: new mongoose.Types.ObjectId(CAL24_IMPORT_ID) },
      update: {
        $set: {
          text: DATA_IMPORT_PAYLOAD.importing.heading,
          subtext: DATA_IMPORT_PAYLOAD.importing.body,
          type: 'DATA_IMPORT_STATUS',
          options: [],
          dataImport: DATA_IMPORT_PAYLOAD,
          skipIf: skipIfStatic,
          sequence: 14.5,
          isActive: true,
        },
      },
      upsert: true,
    },
  ];
}

async function migrate({ apply }) {
  console.log(
    `\n--- CAL-24 onboarding migration (${apply ? 'APPLY' : 'DRY-RUN'}) ---\n`
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
      console.log(
        `  + ${op.label}: will INSERT (sequence ${op.update.$set.sequence})`
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
        ? `  · ${op.label}: will update (seq ${before.sequence})`
        : `  · ${op.label}: no change (seq ${before.sequence})`
    );
  }

  if (!apply) {
    console.log('\nℹ Dry-run only. Re-run with --apply to persist.\n');
    return;
  }

  // 2) Apply phase — wrapped in a transaction on replica sets, falls back to
  // a non-transactional loop on standalone dev Mongo. Idempotency comes from
  // each op's filter+$set shape, so re-running after a partial failure is safe.
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
  const choice = await Question.findById(CAL24_CHOICE_ID).lean();
  const priming = await Question.findById(CAL24_PRIMING_ID).lean();
  const importQ = await Question.findById(CAL24_IMPORT_ID).lean();

  console.log('--- Final state ---');
  console.log(
    `Q14.1 (choice)   type: ${choice?.type}, options: ${
      choice?.options?.length || 0
    }, choicePreview: ${choice?.choicePreview ? 'present' : 'MISSING'}`
  );
  console.log(
    `Q14.3 (priming)  type: ${priming?.type}, healthPermissionPriming: ${
      priming?.healthPermissionPriming ? 'present' : 'MISSING'
    }, skipIf: ${priming?.skipIf?.length || 0}`
  );
  console.log(
    `Q14.5 (import)   type: ${importQ?.type}, dataImport states: ${
      importQ?.dataImport ? Object.keys(importQ.dataImport).length : 'MISSING'
    }, skipIf: ${importQ?.skipIf?.length || 0}`
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
  CAL24_CHOICE_ID,
  CAL24_PRIMING_ID,
  CAL24_IMPORT_ID,
  CHOICE_OPTIONS,
  CHOICE_PREVIEW_PAYLOAD,
  PRIMING_PAYLOAD,
  DATA_IMPORT_PAYLOAD,
  buildOps,
  buildChoiceSkipIf,
};
