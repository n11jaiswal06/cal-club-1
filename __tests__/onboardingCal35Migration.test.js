// CAL-35 migration shape tests. Hermetic — inspects the planned ops
// returned by buildOps() without touching Mongo.

const {
  ACTIVITY_LEVEL_OPTIONS,
  ACTIVITY_QUESTION_TEXT,
  ACTIVITY_QUESTION_SUBTEXT,
  buildOps,
} = require('../scripts/migrate_onboarding_cal35');

describe('CAL-35 migration ops', () => {
  const ops = buildOps();
  const bySeq = Object.fromEntries(
    ops.map((op) => [op.filter.sequence, op])
  );

  test('builds exactly two ops, both keyed by sequence', () => {
    expect(ops).toHaveLength(2);
    expect(bySeq[2]).toBeDefined();
    expect(bySeq[3]).toBeDefined();
  });

  test('Q2 (workouts/week) gets isActive: false, no upsert', () => {
    const op = bySeq[2];
    expect(op.upsert).toBe(false);
    expect(op.update.$set).toEqual({ isActive: false });
  });

  test('Q3 is rewritten with new text, subtext, and PAL-band options', () => {
    const op = bySeq[3];
    expect(op.upsert).toBe(false);
    const set = op.update.$set;
    expect(set.text).toBe(ACTIVITY_QUESTION_TEXT);
    expect(set.subtext).toBe(ACTIVITY_QUESTION_SUBTEXT);
    expect(set.type).toBe('SELECT');
    expect(set.isActive).toBe(true);
    expect(set.options).toEqual(ACTIVITY_LEVEL_OPTIONS);
  });
});

describe('CAL-35 migration fingerprints — guards against reordered DBs', () => {
  const ops = buildOps();
  const bySeq = Object.fromEntries(
    ops.map((op) => [op.filter.sequence, op])
  );

  test('every op carries a fingerprint predicate', () => {
    for (const op of ops) {
      expect(typeof op.fingerprint).toBe('function');
    }
  });

  describe('Q2 fingerprint (workouts/week)', () => {
    const fingerprint = bySeq[2].fingerprint;

    test('accepts pre-migration text', () => {
      expect(fingerprint({ text: 'How many workouts do you do per week?' })).toBe(true);
    });

    test('accepts post-migration state (text unchanged, isActive flipped)', () => {
      expect(
        fingerprint({ text: 'How many workouts do you do per week?', isActive: false })
      ).toBe(true);
    });

    test('rejects an unrelated question that happens to land at sequence 2', () => {
      expect(fingerprint({ text: "What's your gender?" })).toBe(false);
      expect(fingerprint({ text: "Choose your goal" })).toBe(false);
    });

    test('rejects malformed docs without crashing', () => {
      expect(fingerprint(null)).toBe(false);
      expect(fingerprint({})).toBe(false);
      expect(fingerprint({ text: null })).toBe(false);
      expect(fingerprint({ text: 42 })).toBe(false);
    });
  });

  describe('Q3 fingerprint (typical activity)', () => {
    const fingerprint = bySeq[3].fingerprint;

    test('accepts the pre-migration text ("typical day")', () => {
      expect(fingerprint({ text: "What's your typical day like?" })).toBe(true);
    });

    test('accepts the post-migration text ("typical activity")', () => {
      expect(fingerprint({ text: "What's your typical activity level?" })).toBe(true);
    });

    test('rejects unrelated questions at sequence 3 on a reordered DB', () => {
      expect(fingerprint({ text: 'How many workouts do you do per week?' })).toBe(false);
      expect(fingerprint({ text: "What's your height and weight?" })).toBe(false);
      expect(fingerprint({ text: "Choose your gender" })).toBe(false);
    });

    test('rejects malformed docs without crashing', () => {
      expect(fingerprint(null)).toBe(false);
      expect(fingerprint({})).toBe(false);
      expect(fingerprint({ text: null })).toBe(false);
    });
  });
});

describe('ACTIVITY_LEVEL_OPTIONS — CAL-35 standard PAL bands', () => {
  test('has exactly five bands in the canonical order', () => {
    expect(ACTIVITY_LEVEL_OPTIONS.map((o) => o.value)).toEqual([
      'sedentary',
      'lightly_active',
      'moderately_active',
      'very_active',
      'extra_active',
    ]);
  });

  test('every option has text, subtext, and value', () => {
    for (const opt of ACTIVITY_LEVEL_OPTIONS) {
      expect(opt.text).toBeTruthy();
      expect(opt.subtext).toBeTruthy();
      expect(opt.value).toBeTruthy();
    }
  });

  test('values exactly match goalService.ACTIVITY_MULTIPLIERS keys (no drift)', () => {
    const goalService = require('../services/goalService');
    const multiplierKeys = Object.keys(goalService.ACTIVITY_MULTIPLIERS).sort();
    const optionValues = ACTIVITY_LEVEL_OPTIONS.map((o) => o.value).sort();
    expect(optionValues).toEqual(multiplierKeys);
  });

  test('moderately_active is marked as the default option', () => {
    const moderate = ACTIVITY_LEVEL_OPTIONS.find((o) => o.value === 'moderately_active');
    expect(moderate.metadata).toEqual({ isDefault: true });
  });

  test('subtext mentions both daily activity AND exercise context (per band)', () => {
    // The whole point of the rewrite — each option needs to bundle
    // occupation + workout context so the user's pick covers both NEAT
    // and EAT in one band.
    const sedentary = ACTIVITY_LEVEL_OPTIONS.find((o) => o.value === 'sedentary');
    expect(sedentary.subtext).toMatch(/desk|sitting|drive/i);
    const lightly = ACTIVITY_LEVEL_OPTIONS.find((o) => o.value === 'lightly_active');
    expect(lightly.subtext).toMatch(/exercise|walking/i);
    const veryActive = ACTIVITY_LEVEL_OPTIONS.find((o) => o.value === 'very_active');
    expect(veryActive.subtext).toMatch(/exercise|physically/i);
  });
});

describe('Question text — conservative-leaning copy (self-report inflation mitigation)', () => {
  test("subtext nudges users to lean lower when between bands", () => {
    // Literature: most users pick one band higher than reality. We hint
    // at the right direction in the question's own subtext.
    expect(ACTIVITY_QUESTION_SUBTEXT).toMatch(/lean lower|pick the lower|adjust later/i);
  });
});
