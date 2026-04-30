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

    test('female 65kg sedentary recomp → exact calorie target 1500 (rounded TDEE, no floor)', () => {
      // RMR = 10*65 + 6.25*165 - 5*32 - 161 = 1360.25
      // NEAT (sedentary) = 1360.25 * 0.10 = 136.025
      // TDEE = 1496.275 → floor doesn't bind → round to 25 = 1500
      const result = goalService.computeTargetsV2(recompInputs);
      expect(result.calorie_target).toBe(1500);
    });

    test('protein target = exactly 2.0 g/kg (rounded to nearest 5g)', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      // 2.0 * 65 = 130 → round(130/5)*5 = 130
      expect(result.macros.protein_g).toBe(130);
    });

    test('fat target = exactly 30% of calorie target (rounded to nearest 5g)', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      // 0.30 * 1500 / 9 = 50.0 → rounds to 50; the 0.6 g/kg floor (39g)
      // does NOT bind here.
      expect(result.macros.fat_g).toBe(50);
      // Sanity: fat_kcal / calorie_target lands exactly on 30% for this fixture.
      expect((result.macros.fat_g * 9) / result.calorie_target).toBeCloseTo(0.30, 4);
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
      expect(result.calorie_target).toBe(1500);
    });

    test('negative pace input still yields zero daily delta', () => {
      const result = goalService.computeTargetsV2({
        ...baseInputs,
        goal_type: 'recomp',
        pace_kg_per_week: -0.5,
      });
      expect(result.daily_kcal_delta).toBe(0);
      expect(result.calorie_target).toBe(1500);
    });
  });

  describe('computeTargetsV2 — floor binds for low-TDEE recomp inputs', () => {
    test('female 40kg/150cm/70yo recomp → 1200 floor binds, warning emitted', () => {
      // RMR = 10*40 + 6.25*150 - 5*70 - 161 = 826.5
      // TDEE (sedentary) = 826.5 * 1.10 = 909.15 → floor 1200 binds → 1200.
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
      // TDEE (sedentary) = 1201.75 → floor 1400 binds → 1400.
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

  describe('computeTargetsV2 — recomp across all activity levels', () => {
    // For the female 65kg/165cm/32yo recomp fixture:
    //   RMR = 1360.25
    //   TDEE = RMR * (1 + NEAT_multiplier)
    //   calorie_target = round(TDEE / 25) * 25 (no floor binds)
    const cases = [
      { activity_level: 'sedentary',   neat_multiplier: 0.10, expected: 1500 },
      { activity_level: 'light',       neat_multiplier: 0.20, expected: 1625 },
      { activity_level: 'active',      neat_multiplier: 0.30, expected: 1775 },
      { activity_level: 'very_active', neat_multiplier: 0.40, expected: 1900 },
      { activity_level: 'dynamic',     neat_multiplier: 0.30, expected: 1775 },
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
  });
});
