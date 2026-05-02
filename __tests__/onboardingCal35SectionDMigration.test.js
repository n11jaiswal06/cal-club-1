// CAL-35 Section D migration shape tests. Hermetic — inspects the
// planned ops returned by buildOps() without touching Mongo.

const mongoose = require('mongoose');
const {
  TYPICAL_ACTIVITY_ID,
  NOTIFICATION_PERMISSION_ID,
  CAL24_CHOICE_ID,
  NEW_TYPICAL_ACTIVITY_SEQUENCE,
  NEW_NOTIFICATION_PERMISSION_SEQUENCE,
  buildOps,
  buildChoiceSkipIf,
} = require('../scripts/migrate_onboarding_cal35_section_d');

describe('CAL-35 Section D migration ops', () => {
  const ops = buildOps();
  const byId = Object.fromEntries(
    ops.map((op) => [String(op.filter._id), op])
  );

  test('builds exactly two ops, both keyed by stable _id', () => {
    expect(ops).toHaveLength(2);
    expect(byId[TYPICAL_ACTIVITY_ID]).toBeDefined();
    expect(byId[NOTIFICATION_PERMISSION_ID]).toBeDefined();
    for (const op of ops) {
      expect(op.upsert).toBe(false);
      expect(op.filter._id).toBeInstanceOf(mongoose.Types.ObjectId);
    }
  });

  test('typical-activity op moves seq 3 → 14.2 (between CHOICE_PREVIEW 14.1 and PRIMING 14.3)', () => {
    const op = byId[TYPICAL_ACTIVITY_ID];
    expect(op.update.$set.sequence).toBe(NEW_TYPICAL_ACTIVITY_SEQUENCE);
    expect(NEW_TYPICAL_ACTIVITY_SEQUENCE).toBeGreaterThan(14.1); // after choice
    expect(NEW_TYPICAL_ACTIVITY_SEQUENCE).toBeLessThan(14.3); // before priming
  });

  test('typical-activity op carries skipIf rule referencing the choice question with value=dynamic', () => {
    const op = byId[TYPICAL_ACTIVITY_ID];
    const skip = op.update.$set.skipIf;
    expect(skip).toHaveLength(1);
    expect(String(skip[0].questionId)).toBe(CAL24_CHOICE_ID);
    expect(skip[0].valueIn).toEqual(['dynamic']);
    expect(skip[0].textIn).toEqual(['Dynamic']);
  });

  test('notification-permission op moves seq 15 → 14.05 (between MEAL_TIMING 14 and CHOICE_PREVIEW 14.1)', () => {
    const op = byId[NOTIFICATION_PERMISSION_ID];
    expect(op.update.$set.sequence).toBe(NEW_NOTIFICATION_PERMISSION_SEQUENCE);
    expect(NEW_NOTIFICATION_PERMISSION_SEQUENCE).toBeGreaterThan(14);
    expect(NEW_NOTIFICATION_PERMISSION_SEQUENCE).toBeLessThan(14.1);
  });

  test('notification-permission op does not touch skipIf or other fields', () => {
    const op = byId[NOTIFICATION_PERMISSION_ID];
    const set = op.update.$set;
    expect(Object.keys(set).sort()).toEqual(['sequence']);
  });
});

describe('CAL-35 Section D fingerprints', () => {
  const ops = buildOps();
  const byId = Object.fromEntries(
    ops.map((op) => [String(op.filter._id), op])
  );

  test('every op carries a fingerprint predicate', () => {
    for (const op of ops) {
      expect(typeof op.fingerprint).toBe('function');
    }
  });

  describe('typical-activity fingerprint', () => {
    const fingerprint = byId[TYPICAL_ACTIVITY_ID].fingerprint;

    test("accepts the post-CAL-35-PR1 text 'typical activity level'", () => {
      expect(fingerprint({ text: "What's your typical activity level?" })).toBe(true);
    });

    test('rejects unrelated questions at the target _id (paranoia)', () => {
      expect(fingerprint({ text: "What's your gender?" })).toBe(false);
      expect(fingerprint({ text: 'How many workouts per week?' })).toBe(false);
    });

    test('rejects malformed docs without crashing', () => {
      expect(fingerprint(null)).toBe(false);
      expect(fingerprint({})).toBe(false);
      expect(fingerprint({ text: 42 })).toBe(false);
    });
  });

  describe('notification-permission fingerprint', () => {
    const fingerprint = byId[NOTIFICATION_PERMISSION_ID].fingerprint;

    test('accepts by type=NOTIFICATION_PERMISSION', () => {
      expect(fingerprint({ type: 'NOTIFICATION_PERMISSION', text: 'whatever' })).toBe(true);
    });

    test('accepts by text fallback when type is missing', () => {
      expect(fingerprint({ text: 'Let us help you hit your goals' })).toBe(true);
    });

    test('rejects unrelated question types at the target _id', () => {
      expect(fingerprint({ type: 'SELECT', text: 'Pick a goal' })).toBe(false);
      expect(fingerprint({ type: 'MEAL_TIMING', text: 'When do you eat?' })).toBe(false);
    });

    test('rejects malformed docs', () => {
      expect(fingerprint(null)).toBe(false);
      expect(fingerprint({})).toBe(false);
    });
  });
});

describe('buildChoiceSkipIf helper', () => {
  test('emits a single rule pinning the CAL-24 choice question', () => {
    const rule = buildChoiceSkipIf(['dynamic']);
    expect(rule).toHaveLength(1);
    expect(String(rule[0].questionId)).toBe(CAL24_CHOICE_ID);
    expect(rule[0].valueIn).toEqual(['dynamic']);
    expect(rule[0].textIn).toEqual(['Dynamic']);
  });

  test('values without a known textIn mapping are passed through unscathed', () => {
    const rule = buildChoiceSkipIf(['dynamic', 'mystery']);
    expect(rule[0].valueIn).toEqual(['dynamic', 'mystery']);
    expect(rule[0].textIn).toEqual(['Dynamic']);
  });
});
