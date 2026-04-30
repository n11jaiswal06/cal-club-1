// Tests for the recomp goal type added in CAL-18.
// Covers: validation accepts 'recomp', daily delta is zero at pace=0,
// macros use the new recomp config (2.0 g/kg protein, 30% fat), and the
// floor still binds when applicable.

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
    test('accepts recomp + pace=0', () => {
      const result = goalService.validateInputs({
        ...baseInputs,
        goal_type: 'recomp',
        pace_kg_per_week: 0,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
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

    test('does not flag a conflict for recomp + pace=0', () => {
      const result = goalService.validateInputs({
        ...baseInputs,
        goal_type: 'recomp',
        pace_kg_per_week: 0,
      });
      expect(result.warnings).toEqual([]);
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

    test('calorie target equals rounded TDEE (no deficit/surplus)', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      // calorie_target rounds to nearest 25; tdee already rounded to nearest int.
      const expected = Math.round(result.tdee / 25) * 25;
      // The floor (1200 for women) may bind for very low TDEE; if so, the
      // target would be 1200 even though delta is zero.
      const floor = 1200;
      const expectedAfterFloor = Math.max(expected, floor);
      // The service applies floor BEFORE rounding, so re-round the floor.
      const expectedRounded =
        expected < floor
          ? Math.round(floor / 25) * 25
          : expected;
      expect(result.calorie_target).toBe(expectedRounded);
    });

    test('protein target ≈ 2.0 g/kg body weight (rounded to 5g)', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      const expectedProtein = Math.round((2.0 * recompInputs.weight_kg) / 5) * 5;
      expect(result.macros.protein_g).toBe(expectedProtein);
    });

    test('fat target lands near 30% of calorie target', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      const fatKcal = result.macros.fat_g * 9;
      const ratio = fatKcal / result.calorie_target;
      // Fat is rounded to 5g and the 0.6 g/kg floor may push higher.
      // Expect ratio to be between 0.27 and 0.34 for normal inputs.
      expect(ratio).toBeGreaterThanOrEqual(0.27);
      expect(ratio).toBeLessThanOrEqual(0.34);
    });

    test('returns goal_type: recomp in the input echo', () => {
      const result = goalService.computeTargetsV2(recompInputs);
      expect(result.inputs.goal_type).toBe('recomp');
    });
  });

  describe('computeTargetsV2 — recomp for a male user', () => {
    test('protein scales with body weight; floor 1400 may bind for very low TDEE', () => {
      const result = goalService.computeTargetsV2({
        ...baseInputs,
        sex_at_birth: 'male',
        weight_kg: 75,
        height_cm: 178,
        age_years: 30,
        goal_type: 'recomp',
        pace_kg_per_week: 0,
      });
      expect(result.macros.protein_g).toBe(Math.round((2.0 * 75) / 5) * 5);
      // 1400 floor never binds for a 75kg active 30yo male, but verify
      // calorie_target is sensible.
      expect(result.calorie_target).toBeGreaterThanOrEqual(1400);
    });
  });
});
