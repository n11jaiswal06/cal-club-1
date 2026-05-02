// scripts/backfill_question_slugs.js
//
// CAL-30: backfill `slug` on canonical onboarding questions.
//
// Why
//   Today the Flutter bloc and onboardingService.PLAN_CREATION pin specific
//   questions by raw Mongo ObjectId hex (e.g. 6908fe66896ccf24778c907d for
//   the goal-type question). Those _ids are only correct in environments
//   that were seeded from the canonical dump — fresh deploys, CI in-memory
//   Mongo, and DR restores mint different _ids and silently drop those
//   questions from the chain. CAL-18's migration carried the same wart via
//   sequence pinning. Slug is a stable, content-derived identity that
//   resolves identically in every environment.
//
// What
//   Finds each canonical question by content fingerprint (NOT by _id —
//   that's the failure mode we're fixing) and sets `slug`. Idempotent:
//   re-runs after --apply produce "no change" lines.
//
// Resolution rules per slug — fail loud on ambiguity:
//   • 0 candidates  → log "skip (not seeded yet)"
//   • >1 candidates → AMBIGUOUS, abort the run (do not guess)
//   • 1 candidate, slug already set to a different value → CONFLICT, abort
//   • 1 candidate, slug already correct → "no change"
//   • 1 candidate, no slug → queue updateOne $set { slug }
//
// Usage
//   node scripts/backfill_question_slugs.js                       # dry-run
//   node scripts/backfill_question_slugs.js --apply               # persist
//   node scripts/backfill_question_slugs.js --only=goal_type,rate_loss
//
// CAL-24 trio (CHOICE_PREVIEW / HEALTH_PERMISSION_PRIMING /
// DATA_IMPORT_STATUS) and CAL-25 end-screens (GOAL_CALCULATION /
// PLAN_SUMMARY) are deliberately deferred — their migrations pre-mint
// stable _ids in-script, so they don't exhibit CAL-30's failure mode.
// Slug them opportunistically when next touched.

const mongoose = require('mongoose');
require('dotenv').config();

const Question = require('../models/schemas/Question');

// Reused from migrate_onboarding_cal18.js — kept inline to avoid coupling
// the backfill script to the migration's lifecycle.
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

function isStandaloneTransactionError(err) {
  if (!err) return false;
  if (err.codeName === 'IllegalOperation') return true;
  if (err.code === 20) return true;
  const msg = String(err.message || '');
  return /transaction numbers are only allowed|replica set|standalone/i.test(msg);
}

// SELECT-type fingerprint covers both new and legacy enum casings.
function isSelectType(doc) {
  return doc?.type === 'SELECT' || doc?.type === 'select';
}

// Reused-in-spirit from cal18.js looksLikeGoalQuestion (lines 158–166).
// Goal-type Q10 has ≥2 options whose text mentions any of the canonical
// goal verbs/nouns — distinct enough not to collide with neighbouring
// questions.
function looksLikeGoalQuestion(doc) {
  if (!isSelectType(doc)) return false;
  const options = Array.isArray(doc.options) ? doc.options : [];
  if (options.length < 2) return false;
  const goalRegex = /(lose|gain|maintain|recomp|weight|muscle)/i;
  const hits = options.filter((opt) => {
    const text = typeof opt === 'string' ? opt : opt?.text;
    return typeof text === 'string' && goalRegex.test(text);
  });
  return hits.length >= 2;
}

function textMatches(doc, regex) {
  return typeof doc?.text === 'string' && regex.test(doc.text);
}

function optionTextMatches(doc, regex) {
  const options = Array.isArray(doc?.options) ? doc.options : [];
  return options.some((opt) => {
    const text = typeof opt === 'string' ? opt : opt?.text;
    return typeof text === 'string' && regex.test(text);
  });
}

function anyOptionHasRatePercent(doc) {
  const options = Array.isArray(doc?.options) ? doc.options : [];
  return options.some((opt) => typeof opt?.metadata?.ratePercent === 'number');
}

// One entry per slug. `fingerprint(doc)` is a pure predicate over a lean
// Question doc — keep them tight enough that exactly one active doc
// matches in a normally-seeded DB. If two match, the script aborts
// rather than guessing.
const SLUG_DEFINITIONS = [
  {
    slug: 'goal_type',
    description: "Q10 — What's your primary goal?",
    fingerprint: looksLikeGoalQuestion,
  },
  {
    slug: 'target_weight',
    description: "Q11 — What's your target weight (kg)?",
    fingerprint: (doc) => textMatches(doc, /target weight/i),
  },
  {
    slug: 'rate_loss',
    description: 'Q13a — How fast do you want to lose weight?',
    fingerprint: (doc) =>
      isSelectType(doc) &&
      textMatches(doc, /(lose.*weight|how fast.*lose)/i) &&
      (anyOptionHasRatePercent(doc) ||
        optionTextMatches(doc, /(gentle|steady|ambitious)/i)),
  },
  {
    slug: 'rate_gain',
    description: 'Q13b — How fast do you want to gain weight?',
    fingerprint: (doc) =>
      isSelectType(doc) &&
      textMatches(doc, /(gain.*weight|how fast.*gain)/i) &&
      (anyOptionHasRatePercent(doc) ||
        optionTextMatches(doc, /(steady|aggressive)/i)),
  },
  {
    slug: 'recomp_expectation',
    description: 'Q13c — Recomp expectation INFO_SCREEN',
    fingerprint: (doc) =>
      doc?.type === 'INFO_SCREEN' &&
      (textMatches(doc, /recomp/i) ||
        (typeof doc?.infoScreen?.heading === 'string' &&
          /recomp/i.test(doc.infoScreen.heading))),
  },
  {
    slug: 'typical_activity',
    description: "Q3 — What's your typical activity level / day like?",
    fingerprint: (doc) =>
      isSelectType(doc) && textMatches(doc, /typical (activity|day)/i),
  },
  {
    slug: 'notification_permission',
    description: 'Q15 — Notification permission screen',
    fingerprint: (doc) => doc?.type === 'NOTIFICATION_PERMISSION',
  },
  {
    slug: 'height_weight',
    description: "Q7 — What's your height and weight?",
    fingerprint: (doc) => textMatches(doc, /(height.*weight|height and weight)/i),
  },
];

function parseOnlyArg() {
  const arg = process.argv.find((a) => a.startsWith('--only='));
  if (!arg) return null;
  const list = arg
    .slice('--only='.length)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? new Set(list) : null;
}

async function planBackfill({ only }) {
  // Single fetch, then filter in-memory per slug. The questions
  // collection is small (a few dozen rows) so this is cheaper and
  // simpler than firing one Mongo query per slug.
  const allActive = await Question.find({ isActive: true }).lean();
  console.log(`Loaded ${allActive.length} active questions for fingerprinting.\n`);

  const ops = [];
  let aborted = false;

  for (const def of SLUG_DEFINITIONS) {
    if (only && !only.has(def.slug)) {
      console.log(`  · ${def.slug}: skipped by --only filter`);
      continue;
    }

    const candidates = allActive.filter(def.fingerprint);

    if (candidates.length === 0) {
      console.log(`  · ${def.slug}: skip — no active doc matches fingerprint (${def.description})`);
      continue;
    }

    if (candidates.length > 1) {
      console.error(
        `  ✗ ${def.slug}: AMBIGUOUS — ${candidates.length} active docs match fingerprint:`
      );
      for (const c of candidates) {
        console.error(`      _id=${c._id}, seq=${c.sequence}, "${c.text}"`);
      }
      console.error('    Manual triage required. Refusing to guess.');
      aborted = true;
      continue;
    }

    const doc = candidates[0];
    if (doc.slug && doc.slug !== def.slug) {
      console.error(
        `  ✗ ${def.slug}: CONFLICT — _id=${doc._id} already has slug="${doc.slug}". Refusing to overwrite.`
      );
      aborted = true;
      continue;
    }

    if (doc.slug === def.slug) {
      console.log(`  · ${def.slug}: no change (already set on _id=${doc._id}, seq=${doc.sequence})`);
      continue;
    }

    console.log(
      `  + ${def.slug}: will set on _id=${doc._id}, seq=${doc.sequence}, "${doc.text}"`
    );
    ops.push({
      slug: def.slug,
      filter: { _id: doc._id },
      update: { $set: { slug: def.slug } },
    });
  }

  if (aborted) {
    throw new Error(
      'Backfill aborted due to AMBIGUOUS or CONFLICT entries. No changes applied.'
    );
  }

  return ops;
}

async function applyOp(op, session) {
  const opts = {};
  if (session) opts.session = session;
  const result = await Question.updateOne(op.filter, op.update, opts);
  const status =
    result.modifiedCount > 0
      ? '✓ updated'
      : result.matchedCount > 0
      ? '· no change'
      : '✗ no match';
  console.log(`  ${status} — slug=${op.slug}`);
}

async function backfill({ apply, only }) {
  console.log(`\n--- CAL-30 question slug backfill (${apply ? 'APPLY' : 'DRY-RUN'}) ---\n`);

  const ops = await planBackfill({ only });

  if (!apply) {
    console.log(
      `\nℹ Dry-run only. ${ops.length} update(s) planned. Re-run with --apply to persist.\n`
    );
    return;
  }

  if (ops.length === 0) {
    console.log('\n✓ No changes to apply.\n');
    return;
  }

  console.log('\nApplying...');
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const op of ops) {
        await applyOp(op, session);
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
        await applyOp(op, null);
      }
    } else {
      throw err;
    }
  } finally {
    await session.endSession();
  }

  console.log('\n✓ Backfill complete.\n');

  const slugged = await Question.find({ slug: { $exists: true } })
    .select('_id slug sequence text')
    .sort({ sequence: 1 })
    .lean();
  console.log('--- Final slugged questions ---');
  for (const q of slugged) {
    console.log(`  ${q.slug.padEnd(26)} _id=${q._id}, seq=${q.sequence}, "${q.text}"`);
  }
  console.log('');
}

async function main() {
  const apply = process.argv.includes('--apply');
  const only = parseOnlyArg();

  await mongoose.connect(getMongoUri());
  console.log('✓ Connected to MongoDB');

  try {
    await backfill({ apply, only });
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('\n✗ Backfill failed:', err.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  SLUG_DEFINITIONS,
  planBackfill,
  looksLikeGoalQuestion,
};
