// scripts/migrate_user_dob_cal36.js
//
// CAL-36: backfills `User.dateOfBirth` from the existing onboarding DOB
// answers (UserQuestion rows for question _id 6908fe66896ccf24778c907a).
//
// Why: CAL-36 adds a top-level `dateOfBirth` field to the User model so
// the Goal Settings sub-flow can suppress the DOB question when a user
// re-enters from Profile (the answer was previously available only as
// a UserQuestion row). This script populates the new field for users
// who already answered DOB during onboarding so they aren't asked again.
//
// Idempotent: bulk update filter is `{ _id: userId, dateOfBirth: { $exists: false } }`,
// so re-runs after --apply hit zero rows. Mirrors the pattern in
// migrate_user_goals_cal21.js.
//
// Usage:
//   node scripts/migrate_user_dob_cal36.js          # dry-run (default)
//   node scripts/migrate_user_dob_cal36.js --apply  # persist changes

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/schemas/User');
const UserQuestion = require('../models/schemas/UserQuestion');

const DOB_QUESTION_ID = '6908fe66896ccf24778c907a';
const MIN_YEAR = 1900;

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
  if (err.code === 20) return true; // legacy IllegalOperation
  const msg = String(err.message || '');
  return /transaction numbers are only allowed|replica set|standalone/i.test(msg);
}

// Parse a raw DOB answer value (typically an ISO date string from the FE
// date picker, but could be a Date instance or epoch millis from a
// hand-edited row). Returns null on anything `new Date()` can't parse or
// a year outside MIN_YEAR..currentYear (filters stray timestamps that
// look like ms-since-epoch, etc.).
function parseDob(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  if (year < MIN_YEAR || year > currentYear) return null;
  return parsed;
}

// Walk every active DOB answer, parse it, and build a list of
// { userId, dateOfBirth } pairs ready for bulkWrite. Logs a warning for
// each row that fails to parse so an operator can investigate.
async function collectBackfillPairs() {
  const dobAnswers = await UserQuestion.find({
    questionId: new mongoose.Types.ObjectId(DOB_QUESTION_ID),
    deletedAt: null,
  })
    .select('userId values')
    .lean();

  const pairs = [];
  let skipped = 0;

  for (const row of dobAnswers) {
    const raw = Array.isArray(row.values) ? row.values[0] : null;
    const parsed = parseDob(raw);
    if (!parsed) {
      console.warn(
        `  ⚠ Skipping userId=${row.userId} — unparseable/out-of-range DOB value: ${JSON.stringify(raw)}`
      );
      skipped += 1;
      continue;
    }
    pairs.push({ userId: row.userId, dateOfBirth: parsed });
  }

  return { scanned: dobAnswers.length, pairs, skipped };
}

async function previewSample(pairs) {
  const sample = pairs.slice(0, 3);
  if (sample.length === 0) return;
  console.log(`\nSample of ${sample.length} planned update(s):`);
  for (const p of sample) {
    console.log(`  _id=${p.userId} → dateOfBirth=${p.dateOfBirth.toISOString()}`);
  }
}

async function applyUpdate(pairs, session) {
  const ops = pairs.map((p) => ({
    updateOne: {
      filter: { _id: p.userId, dateOfBirth: { $exists: false } },
      update: { $set: { dateOfBirth: p.dateOfBirth } },
    },
  }));

  const opts = session ? { session, ordered: false } : { ordered: false };
  return User.bulkWrite(ops, opts);
}

async function migrate({ apply }) {
  console.log(`\n--- CAL-36 user dateOfBirth backfill (${apply ? 'APPLY' : 'DRY-RUN'}) ---\n`);

  const { scanned, pairs, skipped } = await collectBackfillPairs();
  console.log(`DOB UserQuestion rows scanned: ${scanned}`);
  console.log(`Parseable DOB values:          ${pairs.length}`);
  console.log(`Skipped (unparseable/range):   ${skipped}`);

  if (pairs.length === 0) {
    console.log('\nNothing to backfill.');
    return;
  }

  await previewSample(pairs);

  if (!apply) {
    console.log('\nℹ Dry-run only. Re-run with --apply to persist.\n');
    return;
  }

  console.log('\nApplying...');
  const session = await mongoose.startSession();
  let usedTransaction = false;
  let result;
  try {
    await session.withTransaction(async () => {
      usedTransaction = true;
      result = await applyUpdate(pairs, session);
    });
  } catch (err) {
    if (!usedTransaction && isStandaloneTransactionError(err)) {
      console.log(
        '  ℹ Standalone Mongo detected — transactions unavailable. Falling ' +
        'back to non-transactional apply. If this run fails mid-way, re-run ' +
        'the script (the filter is idempotent).'
      );
      result = await applyUpdate(pairs, null);
    } else {
      throw err;
    }
  } finally {
    await session.endSession();
  }

  // bulkWrite returns matchedCount/modifiedCount. matchedCount counts
  // rows that satisfied the filter (i.e. user existed AND had no prior
  // dateOfBirth). modifiedCount counts those actually written. The
  // difference between pairs.length and matchedCount is "users who
  // already had dateOfBirth set" — expected on re-runs and harmless.
  console.log(
    `  ✓ matched=${result.matchedCount} modified=${result.modifiedCount} ` +
    `(of ${pairs.length} planned)`
  );

  // Verify final state.
  const userIds = pairs.map((p) => p.userId);
  const stillMissing = await User.countDocuments({
    _id: { $in: userIds },
    dateOfBirth: { $exists: false },
  });
  console.log(
    `\nUsers from this batch still missing dateOfBirth: ${stillMissing}`
  );
  if (stillMissing !== 0) {
    console.log(
      '  ⚠ Some users were skipped (likely deleted or filter mismatch). Investigate.'
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

if (require.main === module) {
  main().catch(async (err) => {
    console.error('\n✗ Migration failed:', err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  DOB_QUESTION_ID,
  MIN_YEAR,
  parseDob,
  collectBackfillPairs,
  applyUpdate,
};
