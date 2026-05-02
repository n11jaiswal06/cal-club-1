// CAL-35: standard activity-multiplier model. TDEE = RMR × multiplier
// where multiplier is one of the five PAL bands. Replaces the old v2
// NEAT + EAT split (which had no empirical backing for its NEAT_PCT
// values).
//
// References for the multiplier values:
//   FAO/WHO/UNU 1985 + 2001 expert consultations on human energy
//   requirements; IOM 2002 DRI report; popularized by McArdle/Katch/
//   Katch *Exercise Physiology* (1990s+). Values derived from
//   doubly-labeled-water population studies.

const goalService = require('../services/goalService');

const malePeak = {
  sex_at_birth: 'male',
  age_years: 30,
  height_cm: 180,
  weight_kg: 80,
  goal_type: 'maintain',
  pace_kg_per_week: 0,
};

describe('GoalService.ACTIVITY_MULTIPLIERS', () => {
  test('exposes the five standard PAL bands with the canonical values', () => {
    expect(goalService.ACTIVITY_MULTIPLIERS).toEqual({
      sedentary: 1.2,
      lightly_active: 1.375,
      moderately_active: 1.55,
      very_active: 1.725,
      extra_active: 1.9,
    });
  });

  test('PREVIEW_STATIC_ACTIVITY_LEVEL points at one of the bands', () => {
    const band = goalService.DYNAMIC.PREVIEW_STATIC_ACTIVITY_LEVEL;
    expect(goalService.ACTIVITY_MULTIPLIERS[band]).toBeDefined();
  });
});

describe('computeTargetsV2 — multiplier-driven TDEE', () => {
  // Male 80kg/180cm/30yo → RMR = 10*80 + 6.25*180 - 5*30 + 5 = 1780.
  const RMR = 1780;

  test.each([
    { activity_level: 'sedentary',         multiplier: 1.2,   raw_tdee: 2136.0 },
    { activity_level: 'lightly_active',    multiplier: 1.375, raw_tdee: 2447.5 },
    { activity_level: 'moderately_active', multiplier: 1.55,  raw_tdee: 2759.0 },
    { activity_level: 'very_active',       multiplier: 1.725, raw_tdee: 3070.5 },
    { activity_level: 'extra_active',      multiplier: 1.9,   raw_tdee: 3382.0 },
  ])(
    'activity_level=$activity_level → tdee=$raw_tdee, surfaces multiplier in result',
    ({ activity_level, multiplier, raw_tdee }) => {
      const result = goalService.computeTargetsV2({ ...malePeak, activity_level });
      expect(result.rmr).toBe(RMR);
      expect(result.tdee).toBe(Math.round(raw_tdee));
      expect(result.activity_multiplier).toBe(multiplier);
    }
  );

  test('result echoes activity_level but not workouts/duration/intensity', () => {
    const result = goalService.computeTargetsV2({
      ...malePeak,
      activity_level: 'moderately_active',
    });
    expect(result.inputs.activity_level).toBe('moderately_active');
    expect(result.inputs.workouts_per_week).toBeUndefined();
    expect(result.inputs.avg_workout_duration_min).toBeUndefined();
    expect(result.inputs.avg_workout_intensity).toBeUndefined();
  });

  test('rejects out-of-band activity_level with a clear error', () => {
    expect(() =>
      goalService.computeTargetsV2({ ...malePeak, activity_level: 'desk' })
    ).toThrow(/Invalid activity_level 'desk'/);
    expect(() =>
      goalService.computeTargetsV2({ ...malePeak, activity_level: 'active' })
    ).toThrow(/Invalid activity_level 'active'/);
  });

  test('ignores workouts_per_week even when caller still sends it (legacy clients)', () => {
    // The old FE may still send workouts_per_week before its own update lands.
    // The new math doesn't read it; result must be identical with or without.
    const without = goalService.computeTargetsV2({
      ...malePeak,
      activity_level: 'moderately_active',
    });
    const withLegacyField = goalService.computeTargetsV2({
      ...malePeak,
      activity_level: 'moderately_active',
      workouts_per_week: 7,
      avg_workout_duration_min: 90,
      avg_workout_intensity: 'high',
    });
    expect(withLegacyField.calorie_target).toBe(without.calorie_target);
    expect(withLegacyField.tdee).toBe(without.tdee);
  });
});

describe('validateInputs — CAL-35 activity_level enum', () => {
  const base = { ...malePeak };

  test.each([
    'sedentary',
    'lightly_active',
    'moderately_active',
    'very_active',
    'extra_active',
  ])('accepts %s', (activity_level) => {
    const result = goalService.validateInputs({ ...base, activity_level });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('rejects old NEAT_PCT vocabulary', () => {
    for (const old of ['active', 'light', 'dynamic']) {
      const result = goalService.validateInputs({ ...base, activity_level: old });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('activity_level'))).toBe(true);
    }
  });

  test('rejects old occupation_level vocabulary', () => {
    for (const old of ['desk', 'mixed', 'standing', 'labor']) {
      const result = goalService.validateInputs({ ...base, activity_level: old });
      expect(result.valid).toBe(false);
    }
  });

  test('does not require activity_level (computeTargetsV2 enforces presence itself)', () => {
    // Some callers (computeChoicePreview, computeDynamicBaseline) don't need
    // activity_level. validateInputs accepts the omission and lets the
    // specific caller enforce it.
    const result = goalService.validateInputs(base);
    expect(result.valid).toBe(true);
  });

  test('no longer validates workouts_per_week range', () => {
    const result = goalService.validateInputs({
      ...base,
      activity_level: 'moderately_active',
      workouts_per_week: 999, // would have triggered the old 0–14 check
    });
    expect(result.valid).toBe(true);
  });
});
