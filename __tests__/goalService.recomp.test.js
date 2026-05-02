// Tests for the recomp goal type added in CAL-18.
// Covers: validation accepts 'recomp' and warns on non-zero pace; the
// service coerces pace to 0 for recomp regardless of input; macros use
// the new recomp config (2.0 g/kg protein, 30% fat); the floor binds
// for low-TDEE inputs; recomp behaves correctly across all activity
// levels.

const goalService = require('../services/goalService');

const baseInputs = {
  sex_at_birth: 'female',
  age_years: 32,
  height_cm: 165,
  weight_kg: 65,
  activity_level: 'sedentary',
};

describe('goalService — recomp goal type', () => {
  describe('validateInputs', () => {
    test('accepts recomp + pace=0 with no warnings', () => {
      const result = goalService.validateInputs({
        ...baseInputs,
        goal_type: 'recomp',
        pace_kg_per_week: 0,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    test('still accepts the legacy three goal types', () => {
      for (const goal of ['lose', 'maintain', 'gain']) {
        const result = goalService.validateInputs({
          ...baseInputs,
          goal_type: goal,
          pace_kg_per_week: goal === 'lose' ? -0.5 : goal === 'gain' ? 0.25 : 0,
        });
        expect(result.valid).toBe(true);
      }
    });

    test('rejects unknown goal types', () => {
      const result = goalService.validateInputs({
        ...baseInputs,
        goal_type: 'bulk',
        pace_kg_per_week: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('goal_type'))).toBe(true);
    });

    test('warns (but accepts) recomp + positive pace; calls out coercion', () => {
      const result = goalService.validateInputs({
        ...baseInputs,
        goal_type: 'recomp',
        pace_kg_per_week: 0.5,
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/recomp/);
      expect(result.warnings[0]).toMatch(/coercing to 0/);
    });

    test('warns (but accepts) recomp + negative pace', () => {
      const result = goalService.validateInputs({
        ...baseInputs,
        goal_type: 'recomp',
        pace_kg_per_week: -0.5,
      });
      expect(result.valid).toBe(true);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatch(/recomp/);
    });
  });

  describe('computeTargetsV2 — recomp at maintenance kcal', () => {
    const recompInputs = {
      ...baseInputs,
      goal_type: 'recomp',
      pace_kg_per_week: 0,
    };

    test('produces a zero daily kcal delta', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      expect(result.daily_kcal_delta).toBe(0);
    });

    test('female 65kg sedentary recomp → exact calorie target 1625 (rounded TDEE, no floor)', () => {
      // CAL-35: standard activity multipliers replace NEAT+EAT.
      // RMR = 10*65 + 6.25*165 - 5*32 - 161 = 1360.25
      // TDEE (sedentary) = 1360.25 * 1.2 = 1632.3 → round to 25 = 1625
      const result = goalService.computeTargetsV2(recompInputs);
      expect(result.calorie_target).toBe(1625);
    });

    test('protein target = exactly 2.0 g/kg (rounded to nearest 5g)', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      // 2.0 * 65 = 130 → round(130/5)*5 = 130
      expect(result.macros.protein_g).toBe(130);
    });

    test('fat target ≈ 30% of calorie target (rounded to nearest 5g)', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      // 0.30 * 1625 / 9 = 54.17 → rounds to 55; the 0.6 g/kg floor (39g)
      // does NOT bind here.
      expect(result.macros.fat_g).toBe(55);
      // Sanity: fat_kcal / calorie_target stays near 30% (rounding nudges
      // it to ~30.5% for this fixture).
      expect((result.macros.fat_g * 9) / result.calorie_target).toBeCloseTo(0.30, 1);
    });

    test('returns goal_type: recomp in the input echo', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      expect(result.inputs.goal_type).toBe('recomp');
    });
  });

  describe('computeTargetsV2 — recomp coerces non-zero pace to 0', () => {
    test('positive pace input still yields zero daily delta', () => {
      const result = goalService.computeTargetsV2({
        ...baseInputs,
        goal_type: 'recomp',
        pace_kg_per_week: 0.5,
      });
      expect(result.daily_kcal_delta).toBe(0);
      // Same calorie target as the pace=0 case — proves the coercion landed.
      expect(result.calorie_target).toBe(1625);
    });

    test('negative pace input still yields zero daily delta', () => {
      const result = goalService.computeTargetsV2({
        ...baseInputs,
        goal_type: 'recomp',
        pace_kg_per_week: -0.5,
      });
      expect(result.daily_kcal_delta).toBe(0);
      expect(result.calorie_target).toBe(1625);
    });
  });

  describe('computeTargetsV2 — floor binds for low-TDEE recomp inputs', () => {
    test('female 40kg/150cm/70yo recomp → 1200 floor binds, warning emitted', () => {
      // RMR = 10*40 + 6.25*150 - 5*70 - 161 = 826.5
      // TDEE (sedentary 1.2) = 991.8 → floor 1200 binds → 1200.
      const result = goalService.computeTargetsV2({
        sex_at_birth: 'female',
        age_years: 70,
        height_cm: 150,
        weight_kg: 40,
        activity_level: 'sedentary',
        goal_type: 'recomp',
        pace_kg_per_week: 0,
      });
      expect(result.calorie_target).toBe(1200);
      expect(result.daily_kcal_delta).toBe(0);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/safety floor.*1200/)])
      );
    });

    test('male 50kg/150cm/70yo recomp → 1400 floor binds, warning emitted', () => {
      // RMR = 10*50 + 6.25*150 - 5*70 + 5 = 1092.5
      // TDEE (sedentary 1.2) = 1311 → floor 1400 binds → 1400.
      const result = goalService.computeTargetsV2({
        sex_at_birth: 'male',
        age_years: 70,
        height_cm: 150,
        weight_kg: 50,
        activity_level: 'sedentary',
        goal_type: 'recomp',
        pace_kg_per_week: 0,
      });
      expect(result.calorie_target).toBe(1400);
      expect(result.daily_kcal_delta).toBe(0);
      expect(result.warnings).toEqual(
        expect.arrayContaining([expect.stringMatching(/safety floor.*1400/)])
      );
    });
  });

  describe('computeTargetsV2 — recomp across all activity levels (CAL-35 multipliers)', () => {
    // For the female 65kg/165cm/32yo recomp fixture:
    //   RMR = 1360.25
    //   TDEE = RMR × ACTIVITY_MULTIPLIER (CAL-35 standard PAL bands)
    //   calorie_target = round(TDEE / 25) * 25 (no floor binds)
    const cases = [
      { activity_level: 'sedentary',         multiplier: 1.2,   expected: 1625 },
      { activity_level: 'lightly_active',    multiplier: 1.375, expected: 1875 },
      { activity_level: 'moderately_active', multiplier: 1.55,  expected: 2100 },
      { activity_level: 'very_active',       multiplier: 1.725, expected: 2350 },
      { activity_level: 'extra_active',      multiplier: 1.9,   expected: 2575 },
    ];

    test.each(cases)(
      'activity_level=$activity_level → calorie_target $expected, delta 0',
      ({ activity_level, expected }) => {
        const result = goalService.computeTargetsV2({
          ...baseInputs,
          activity_level,
          goal_type: 'recomp',
          pace_kg_per_week: 0,
        });
        expect(result.calorie_target).toBe(expected);
        expect(result.daily_kcal_delta).toBe(0);
        // Protein scales only with weight, so it's identical across all
        // activity levels for the same body weight.
        expect(result.macros.protein_g).toBe(130);
      }
    );

    test('rejects out-of-band activity_level with a clear error', () => {
      expect(() =>
        goalService.computeTargetsV2({
          ...baseInputs,
          activity_level: 'desk',
          goal_type: 'recomp',
          pace_kg_per_week: 0,
        })
      ).toThrow(/Invalid activity_level 'desk'/);
    });
  });
});
