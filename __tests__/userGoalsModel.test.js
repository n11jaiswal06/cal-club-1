// Schema-level tests for the four CAL-21 fields on User.goals.
// Uses Mongoose validateSync() so no DB connection is required.

const User = require('../models/schemas/User');

function buildUser(goals) {
  return new User({
    phone: '+15555550100',
    name: 'Test User',
    goals,
  });
}

describe('User.goals schema (CAL-21 fields)', () => {
  describe('goalType enum', () => {
    test.each(['dynamic', 'static'])("accepts '%s'", (value) => {
      const err = buildUser({ goalType: value }).validateSync();
      expect(err && err.errors && err.errors['goals.goalType']).toBeUndefined();
    });

    test('rejects invalid enum value', () => {
      const err = buildUser({ goalType: 'flex' }).validateSync();
      expect(err.errors['goals.goalType']).toBeDefined();
      expect(err.errors['goals.goalType'].kind).toBe('enum');
    });
  });

  describe('intent enum', () => {
    test.each(['dynamic', 'static'])("accepts '%s'", (value) => {
      const err = buildUser({ intent: value }).validateSync();
      expect(err && err.errors && err.errors['goals.intent']).toBeUndefined();
    });

    test('rejects invalid enum value', () => {
      const err = buildUser({ intent: 'maybe' }).validateSync();
      expect(err.errors['goals.intent']).toBeDefined();
      expect(err.errors['goals.intent'].kind).toBe('enum');
    });
  });

  describe('outcome enum', () => {
    test.each([
      'dynamic',
      'static_chosen',
      'static_permission_denied',
      'static_sync_failed',
    ])("accepts '%s'", (value) => {
      const err = buildUser({ outcome: value }).validateSync();
      expect(err && err.errors && err.errors['goals.outcome']).toBeUndefined();
    });

    test('rejects invalid enum value', () => {
      const err = buildUser({ outcome: 'static_unknown' }).validateSync();
      expect(err.errors['goals.outcome']).toBeDefined();
      expect(err.errors['goals.outcome'].kind).toBe('enum');
    });
  });

  describe('baselineGoal range', () => {
    test('accepts 0', () => {
      const err = buildUser({ baselineGoal: 0 }).validateSync();
      expect(err && err.errors && err.errors['goals.baselineGoal']).toBeUndefined();
    });

    test('accepts mid-range value', () => {
      const err = buildUser({ baselineGoal: 2200 }).validateSync();
      expect(err && err.errors && err.errors['goals.baselineGoal']).toBeUndefined();
    });

    test('accepts 10000 (upper bound)', () => {
      const err = buildUser({ baselineGoal: 10000 }).validateSync();
      expect(err && err.errors && err.errors['goals.baselineGoal']).toBeUndefined();
    });

    test('rejects negative', () => {
      const err = buildUser({ baselineGoal: -1 }).validateSync();
      expect(err.errors['goals.baselineGoal']).toBeDefined();
      expect(err.errors['goals.baselineGoal'].kind).toBe('min');
    });

    test('rejects > 10000', () => {
      const err = buildUser({ baselineGoal: 10001 }).validateSync();
      expect(err.errors['goals.baselineGoal']).toBeDefined();
      expect(err.errors['goals.baselineGoal'].kind).toBe('max');
    });
  });

  test('all four fields unset is valid (pre-migration legacy users)', () => {
    // Legacy users who haven't been backfilled or hit calculate-and-save
    // since CAL-21 ship: their docs have none of the new fields. Schema
    // must not reject them — the migration script handles backfill.
    const err = buildUser({ dailyCalories: 2000 }).validateSync();
    expect(err && err.errors && err.errors['goals.goalType']).toBeUndefined();
    expect(err && err.errors && err.errors['goals.intent']).toBeUndefined();
    expect(err && err.errors && err.errors['goals.outcome']).toBeUndefined();
    expect(err && err.errors && err.errors['goals.baselineGoal']).toBeUndefined();
  });

  test('full valid combo (post calculate-and-save save) passes validation', () => {
    const err = buildUser({
      dailyCalories: 2100,
      dailyProtein: 150,
      dailyCarbs: 240,
      dailyFats: 70,
      goalType: 'dynamic',
      intent: 'dynamic',
      outcome: 'dynamic',
      baselineGoal: 2100,
    }).validateSync();
    expect(err).toBeUndefined();
  });

  describe('CAL-44 macro recipe fields', () => {
    test('weightGoalType accepts all four enum values', () => {
      for (const v of ['lose', 'maintain', 'gain', 'recomp']) {
        const err = buildUser({ weightGoalType: v }).validateSync();
        expect(err && err.errors && err.errors['goals.weightGoalType']).toBeUndefined();
      }
    });

    test('weightGoalType rejects invalid enum', () => {
      const err = buildUser({ weightGoalType: 'cut' }).validateSync();
      expect(err.errors['goals.weightGoalType']).toBeDefined();
      expect(err.errors['goals.weightGoalType'].kind).toBe('enum');
    });

    test('weightKg range — accepts 70, rejects negative and > 500', () => {
      expect(buildUser({ weightKg: 70 }).validateSync()).toBeUndefined();
      expect(buildUser({ weightKg: -1 }).validateSync().errors['goals.weightKg'].kind).toBe('min');
      expect(buildUser({ weightKg: 501 }).validateSync().errors['goals.weightKg'].kind).toBe('max');
    });

    test('proteinGramsPerKg range — accepts 2.0, rejects > 5', () => {
      expect(buildUser({ proteinGramsPerKg: 2.0 }).validateSync()).toBeUndefined();
      expect(buildUser({ proteinGramsPerKg: 6 }).validateSync().errors['goals.proteinGramsPerKg'].kind).toBe('max');
    });

    test('fatPctFloor range — accepts 0.25, rejects > 1', () => {
      expect(buildUser({ fatPctFloor: 0.25 }).validateSync()).toBeUndefined();
      expect(buildUser({ fatPctFloor: 1.5 }).validateSync().errors['goals.fatPctFloor'].kind).toBe('max');
    });

    test('fatGramsPerKgFloor default = 0.6 when unset', () => {
      const u = buildUser({});
      expect(u.goals.fatGramsPerKgFloor).toBe(0.6);
    });

    test('full CAL-44 dynamic combo passes validation', () => {
      const err = buildUser({
        dailyCalories: 1540, dailyProtein: 140, dailyCarbs: 149, dailyFats: 43,
        goalType: 'dynamic', intent: 'dynamic', outcome: 'dynamic',
        baselineGoal: 1540, rmr: 1500,
        weightKg: 70, weightGoalType: 'lose',
        proteinGramsPerKg: 2.0, fatPctFloor: 0.25, fatGramsPerKgFloor: 0.6
      }).validateSync();
      expect(err).toBeUndefined();
    });
  });
});
