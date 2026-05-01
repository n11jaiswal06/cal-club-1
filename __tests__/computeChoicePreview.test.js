// Tests for goalService.computeChoicePreview (CAL-22).
//
// PRD §6.4 + §7.5 + §12 worked examples — these are the four numbers the
// Dynamic-vs-Static choice screen renders. Same inputs as the
// computeDynamicBaseline tests; here we additionally verify the three
// dynamic rows (rest/active/workout) and the static row.

const goalService = require('../services/goalService');

describe('goalService.computeChoicePreview — PRD §12 worked examples', () => {
  test.each([
    {
      label: 'Example 1 — 70kg woman, lose 0.5%/wk',
      inputs: {
        sex_at_birth: 'female', age_years: 30, height_cm: 161.76, weight_kg: 70,
        goal_type: 'lose', pace_kg_per_week: -0.35,
      },
      expected: { dynamic_baseline: 1295, dynamic_rest: 1445, dynamic_active: 1695, dynamic_workout: 1820 },
    },
    {
      label: 'Example 2 — 80kg man, lose 1%/wk (floor binds)',
      inputs: {
        sex_at_birth: 'male', age_years: 30, height_cm: 180, weight_kg: 80,
        goal_type: 'lose', pace_kg_per_week: -0.80,
      },
      expected: { dynamic_baseline: 1400, dynamic_rest: 1550, dynamic_active: 1800, dynamic_workout: 1925 },
    },
    {
      label: 'Example 3 — 75kg man, gain 0.25%/wk',
      inputs: {
        sex_at_birth: 'male', age_years: 30, height_cm: 175.166, weight_kg: 75,
        goal_type: 'gain', pace_kg_per_week: 0.1875,
      },
      expected: { dynamic_baseline: 2246, dynamic_rest: 2396, dynamic_active: 2646, dynamic_workout: 2771 },
    },
    {
      label: 'Example 4 — 65kg woman, recomp',
      inputs: {
        sex_at_birth: 'female', age_years: 30, height_cm: 161.76, weight_kg: 65,
        goal_type: 'recomp', pace_kg_per_week: 0,
      },
      expected: { dynamic_baseline: 1620, dynamic_rest: 1770, dynamic_active: 2020, dynamic_workout: 2145 },
    },
  ])('$label', ({ inputs, expected }) => {
    const result = goalService.computeChoicePreview(inputs);
    expect(result.dynamic_baseline).toBe(expected.dynamic_baseline);
    expect(result.dynamic_rest).toBe(expected.dynamic_rest);
    expect(result.dynamic_active).toBe(expected.dynamic_active);
    expect(result.dynamic_workout).toBe(expected.dynamic_workout);
    expect(typeof result.static).toBe('number');
  });
});

describe('goalService.computeChoicePreview — invariants', () => {
  test('static value falls within the dynamic range for typical inputs', () => {
    // Acceptance criterion from CAL-22: dynamic_baseline ≤ static ≤ dynamic_workout.
    const result = goalService.computeChoicePreview({
      sex_at_birth: 'female', age_years: 30, height_cm: 161.76, weight_kg: 70,
      goal_type: 'lose', pace_kg_per_week: -0.35,
    });
    expect(result.static).toBeGreaterThanOrEqual(result.dynamic_baseline);
    expect(result.static).toBeLessThanOrEqual(result.dynamic_workout);
  });

  test('default static activity_level applies when caller omits it', () => {
    // The choice screen runs before the static-lifestyle questions, so the
    // caller typically won't have activity_level. The endpoint must default
    // to a sensible constant rather than throw.
    const inputs = {
      sex_at_birth: 'male', age_years: 30, height_cm: 180, weight_kg: 80,
      goal_type: 'maintain', pace_kg_per_week: 0,
    };
    const result = goalService.computeChoicePreview(inputs);
    expect(result.meta.assumptions.static_activity_level).toBe('active');
    expect(typeof result.static).toBe('number');
  });

  test('explicit activity_level overrides the default', () => {
    const inputs = {
      sex_at_birth: 'male', age_years: 30, height_cm: 180, weight_kg: 80,
      goal_type: 'maintain', pace_kg_per_week: 0,
      activity_level: 'sedentary',
    };
    const result = goalService.computeChoicePreview(inputs);
    expect(result.meta.assumptions.static_activity_level).toBe('sedentary');
  });

  test('meta surfaces tunable assumptions for client disclosure copy', () => {
    const result = goalService.computeChoicePreview({
      sex_at_birth: 'female', age_years: 30, height_cm: 161.76, weight_kg: 70,
      goal_type: 'lose', pace_kg_per_week: -0.35,
    });
    expect(result.meta.assumptions).toEqual({
      rest_steps: 3000,
      active_steps: 8000,
      workout_kcal: 250,
      step_coef: 0.05,
      workout_haircut: 0.5,
      static_activity_level: 'active',
    });
    expect(result.meta.floor).toBe(1200);
    expect(result.meta.floor_applied).toBe(false);
  });

  test('floor_applied flag is true when the floor binds (Example 2)', () => {
    const result = goalService.computeChoicePreview({
      sex_at_birth: 'male', age_years: 30, height_cm: 180, weight_kg: 80,
      goal_type: 'lose', pace_kg_per_week: -0.80,
    });
    expect(result.meta.floor_applied).toBe(true);
    expect(result.meta.floor).toBe(1400);
  });
});
