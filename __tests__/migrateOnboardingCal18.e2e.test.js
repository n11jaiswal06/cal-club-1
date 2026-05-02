// CAL-18 migration — end-to-end regression tests against an in-memory
// Mongo. Complements __tests__/onboardingCal35Migration.test.js (hermetic,
// shape-only) by exercising the actual updateOne / upsert path.
//
// Each test seeds a different pre-migration state, calls migrate({ apply:
// true }), then asserts the post-state. The four scenarios mirror the
// CAL-31 acceptance list.

const mongoose = require('mongoose');
const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');

const Question = require('../models/schemas/Question');
const { migrate } = require('../scripts/migrate_onboarding_cal18');

// Quiet the migration's console.log/console.error during tests; the
// transactions-unavailable warning is expected on standalone Mongo and the
// per-op status lines drown the Jest output otherwise.
let logSpy, errSpy;

beforeAll(async () => {
  await setupMongoServer();
  // Build the unique indexes (sequence, slug) before any test seeds rows;
  // otherwise the uniqueness assertions in tests are silently no-ops.
  await Question.init();
});

afterAll(async () => {
  await teardownMongoServer();
});

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  await clearAllCollections();
});

// --- fixtures ---------------------------------------------------------------

const CANONICAL_GOAL_OPTIONS_PRE = [
  // Pre-CAL-18 shape: 3 options, no `value` field. Goal-shaped enough to
  // pass looksLikeGoalQuestion (≥2 options match /(lose|gain|maintain|recomp|weight|muscle)/).
  { text: 'Lose weight' },
  { text: 'Gain weight' },
  { text: 'Maintain' },
];

const KG_OPTIONS = [
  { text: '0.1 kg' },
  { text: '0.25 kg' },
  { text: '0.5 kg' },
  { text: '0.75 kg' },
  { text: '1.0 kg' },
];

async function seedGoalQuestion({ sequence = 10, slug = 'goal_type' } = {}) {
  return Question.create({
    text: 'Choose your goal',
    type: 'SELECT',
    options: CANONICAL_GOAL_OPTIONS_PRE,
    sequence,
    slug,
    isActive: true,
  });
}

async function seedTargetWeight({ sequence = 11 } = {}) {
  return Question.create({
    text: "What's your target weight (kg)?",
    type: 'PICKER',
    sequence,
    isActive: true,
  });
}

async function seedEncouragement({ sequence = 12 } = {}) {
  return Question.create({
    text: "You're on the right track!",
    type: 'NO_INPUT',
    sequence,
    isActive: true,
  });
}

async function seedOldSelectRateQ({ sequence = 13.0 } = {}) {
  return Question.create({
    text: 'How much weight do you want to lose per week?',
    type: 'SELECT',
    options: KG_OPTIONS,
    sequence,
    isActive: true,
  });
}

// Seed the canonical baseline used by tests 1 and 4. No slug-bearing
// rate_loss/gain/recomp rows exist yet — the migration will insert them.
async function seedBaselineCanonical() {
  const goalQ = await seedGoalQuestion();
  const targetQ = await seedTargetWeight();
  const encQ = await seedEncouragement();
  const oldRateQ = await seedOldSelectRateQ();
  return { goalQ, targetQ, encQ, oldRateQ };
}

// --- tests ------------------------------------------------------------------

describe('CAL-18 migrate({ apply: true })', () => {
  describe('idempotency', () => {
    test('second run produces no document changes and no duplicate inserts', async () => {
      await seedBaselineCanonical();
      await migrate({ apply: true });

      const afterFirst = await Question.find({}).lean().sort({ sequence: 1 });
      const firstCount = afterFirst.length;
      // Strip Mongoose-managed timestamp fields before comparing. The
      // CAL-31 acceptance phrases idempotency as "modifiedCount === 0 on
      // re-run", but that metric isn't directly reachable here: Question
      // has `{ timestamps: true }` and the migration's runOp uses
      // Mongoose's default updateOne, which auto-injects $set:{updatedAt:
      // now} on every call. Mongo then sees the doc as changed and reports
      // modifiedCount: 1 even when no semantic field differs.
      //
      // What's actually verifiable — and what matters operationally — is
      // that the second run produces no data drift: same row count, same
      // _ids, identical content. That's what this snapshot asserts.
      const stripVolatile = (doc) => {
        const { updatedAt, createdAt, __v, ...rest } = doc;
        return rest;
      };
      const firstSnapshot = afterFirst.map(stripVolatile);
      const firstIds = afterFirst.map((d) => String(d._id)).sort();

      await migrate({ apply: true });

      const afterSecond = await Question.find({}).lean().sort({ sequence: 1 });
      const secondIds = afterSecond.map((d) => String(d._id)).sort();
      expect(afterSecond).toHaveLength(firstCount);
      expect(secondIds).toEqual(firstIds);
      expect(afterSecond.map(stripVolatile)).toEqual(firstSnapshot);
    });
  });

  describe('Q10 fingerprint guard (P2.1 regression)', () => {
    test('refuses to overwrite a non-goal-shaped question that drifted to sequence:10', async () => {
      // Goal question lives elsewhere with NO slug and NO pinned _id —
      // forcing findGoalQuestion to walk past the slug rung, the pinned-id
      // rung, and the sequence:10 fingerprint rung (which must reject the
      // unrelated question), landing on the content fingerprint rung.
      const goalQ = await Question.create({
        text: 'Choose your goal',
        type: 'SELECT',
        options: CANONICAL_GOAL_OPTIONS_PRE,
        sequence: 9,
        isActive: true,
      });

      // An unrelated SELECT that happens to sit at sequence:10. Options
      // intentionally avoid lose/gain/maintain/recomp/weight/muscle so
      // looksLikeGoalQuestion returns false for this row.
      const barriersOptions = [
        { text: 'Time' },
        { text: 'Motivation' },
        { text: 'Knowledge' },
        { text: 'Energy' },
      ];
      const intruder = await Question.create({
        text: "What's been getting in the way?",
        type: 'SELECT',
        options: barriersOptions,
        sequence: 10,
        isActive: true,
      });

      await seedTargetWeight({ sequence: 11 });
      await seedEncouragement({ sequence: 12 });

      await migrate({ apply: true });

      const intruderAfter = await Question.findById(intruder._id).lean();
      expect(intruderAfter.text).toBe("What's been getting in the way?");
      expect(intruderAfter.options.map((o) => o.text)).toEqual(
        barriersOptions.map((o) => o.text)
      );
      // Did NOT receive the goal-question slug or 4-option treatment.
      expect(intruderAfter.slug).toBeUndefined();

      const goalAfter = await Question.findById(goalQ._id).lean();
      expect(goalAfter.text).toBe("What's your primary goal?");
      expect(goalAfter.slug).toBe('goal_type');
      expect(goalAfter.options.map((o) => o.value)).toEqual([
        'gain',
        'lose',
        'recomp',
        'maintain',
      ]);
    });
  });

  describe('rateQ-at-13.x deactivate path', () => {
    test('deactivates the old SELECT rate question by _id without clobbering the slug-bearing Q13a', async () => {
      // The CAL-31 ticket frames this as "rateQ at 13.3" but Question.sequence
      // is unique — Q13a's canonical 13.3 slot can hold exactly one row. The
      // realistic drift is: an old kg-options SELECT sits at a different
      // sequence (13.0 here) and resolves via the `0.X kg` fingerprint, while
      // the slug-bearing Q13a already lives at 13.3. The risk being guarded:
      // the deactivate op (which targets rateQ by _id) must not accidentally
      // share an _id with — or otherwise mutate — the slug-bearing row.
      await seedGoalQuestion();
      const oldRateQ = await seedOldSelectRateQ({ sequence: 13.0 });
      const preExistingQ13a = await Question.create({
        slug: 'rate_loss',
        text: 'How fast do you want to lose weight?',
        type: 'SELECT',
        options: [
          { text: 'Gentle', value: 'gentle' },
          { text: 'Steady', value: 'steady' },
          { text: 'Ambitious', value: 'ambitious' },
        ],
        sequence: 13.3,
        isActive: true,
      });

      await migrate({ apply: true });

      const oldAfter = await Question.findById(oldRateQ._id).lean();
      expect(oldAfter.isActive).toBe(false);
      // Old options preserved (we only flipped isActive).
      expect(oldAfter.options.map((o) => o.text)).toEqual(
        KG_OPTIONS.map((o) => o.text)
      );

      const q13aAfter = await Question.findById(preExistingQ13a._id).lean();
      expect(q13aAfter.slug).toBe('rate_loss');
      expect(q13aAfter.isActive).toBe(true);
      expect(q13aAfter.sequence).toBe(13.3);
      // Migration's $set wrote the canonical loss options with metadata.
      expect(q13aAfter.options.map((o) => o.value)).toEqual([
        'gentle',
        'steady',
        'ambitious',
      ]);
      const steady = q13aAfter.options.find((o) => o.value === 'steady');
      expect(steady.metadata.isDefault).toBe(true);
      expect(steady.metadata.ratePercent).toBeCloseTo(0.005);

      // The two rows remain distinct.
      expect(String(oldAfter._id)).not.toBe(String(q13aAfter._id));
    });
  });

  describe('skipIf payload round-trip', () => {
    test('persists questionId / valueIn / textIn through Mongoose', async () => {
      const { goalQ } = await seedBaselineCanonical();

      await migrate({ apply: true });

      const finalGoal = await Question.findOne({ slug: 'goal_type' }).lean();
      const goalId = String(finalGoal._id);
      expect(goalId).toBe(String(goalQ._id));

      const expectations = [
        {
          slugOrText: { text: /target weight/i },
          valueIn: ['maintain', 'recomp'],
          textIn: ['Maintain', 'Build muscle while losing weight'],
        },
        {
          slugOrText: { text: /right track/i },
          valueIn: ['maintain', 'recomp'],
          textIn: ['Maintain', 'Build muscle while losing weight'],
        },
        {
          slugOrText: { slug: 'rate_loss' },
          valueIn: ['gain', 'recomp', 'maintain'],
          textIn: ['Gain muscle', 'Build muscle while losing weight', 'Maintain'],
        },
        {
          slugOrText: { slug: 'rate_gain' },
          valueIn: ['lose', 'recomp', 'maintain'],
          textIn: ['Lose fat', 'Build muscle while losing weight', 'Maintain'],
        },
        {
          slugOrText: { slug: 'recomp_expectation' },
          valueIn: ['gain', 'lose', 'maintain'],
          textIn: ['Gain muscle', 'Lose fat', 'Maintain'],
        },
      ];

      for (const exp of expectations) {
        const filter = exp.slugOrText.slug
          ? { slug: exp.slugOrText.slug }
          : { text: { $regex: exp.slugOrText.text } };
        const doc = await Question.findOne(filter).lean();
        expect(doc).toBeTruthy();
        expect(Array.isArray(doc.skipIf)).toBe(true);
        expect(doc.skipIf).toHaveLength(1);
        const rule = doc.skipIf[0];
        expect(String(rule.questionId)).toBe(goalId);
        expect(rule.valueIn).toEqual(exp.valueIn);
        expect(rule.textIn).toEqual(exp.textIn);
      }
    });
  });
});
