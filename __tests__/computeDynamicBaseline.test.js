// Tests for goalService.computeDynamicBaseline (CAL-22).
//
// PRD §12 worked examples are the acceptance bar — these are the same
// numbers the choice screen will display, so a regression here would
// silently misprice every Dynamic user's baseline goal.
//
// The PRD examples specify weight + goal + rate but not the BMR's age/
// height inputs, so the height_cm values below are derived to hit the
// published BMR exactly (note inline per case). For Example 2 the floor
// binds, so any realistic male inputs that drive pre_floor below 1400
// produce the same result — we use a normal 30/180/80 profile there.

const goalService = require('../services/goalService');

describe('goalService.computeDynamicBaseline — PRD §12 worked examples', () => {
  test('Example 1: 70kg woman, lose 0.5%/wk → baseline 1295', () => {
    // Need BMR=1400 (so BMR×1.2 - 385 = 1295). Female: 6.25H - 5A = 861.
    // age=30 → H=161.76.
    const result = goalService.computeDynamicBaseline({
      sex_at_birth: 'female',
      age_years: 30,
      height_cm: 161.76,
      weight_kg: 70,
      goal_type: 'lose',
      pace_kg_per_week: -0.35, // 0.5% × 70kg
    });
    expect(result.baseline).toBe(1295);
    expect(result.floor_applied).toBe(false);
  });

  test('Example 2: 80kg man, lose 1%/wk → baseline 1400 (floor binds)', () => {
    // Realistic male: BMR=1780, sed_tdee=2136, pre_floor=1256, floored to 1400.
    const result = goalService.computeDynamicBaseline({
      sex_at_birth: 'male',
      age_years: 30,
      height_cm: 180,
      weight_kg: 80,
      goal_type: 'lose',
      pace_kg_per_week: -0.80, // 1% × 80kg
    });
    expect(result.baseline).toBe(1400);
    expect(result.floor).toBe(1400);
    expect(result.floor_applied).toBe(true);
    expect(result.pre_floor).toBeLessThan(1400);
  });

  test('Example 3: 75kg man, gain 0.25%/wk → baseline 2246', () => {
    // Need BMR≈1699.79 (so BMR×1.2 + 206.25 = 2246). Male: 6.25H - 5A = 944.79.
    // age=30 → H=175.166.
    const result = goalService.computeDynamicBaseline({
      sex_at_birth: 'male',
      age_years: 30,
      height_cm: 175.166,
      weight_kg: 75,
      goal_type: 'gain',
      pace_kg_per_week: 0.1875, // 0.25% × 75kg
    });
    expect(result.baseline).toBe(2246);
    expect(result.floor_applied).toBe(false);
  });

  test('Example 4: 65kg woman, recomp → baseline 1620 (pace coerced to 0)', () => {
    // Need BMR=1350 (so BMR×1.2 = 1620). Female: 6.25H - 5A = 861.
    // age=30 → H=161.76. Pace is irrelevant (recomp coerces to 0).
    const result = goalService.computeDynamicBaseline({
      sex_at_birth: 'female',
      age_years: 30,
      height_cm: 161.76,
      weight_kg: 65,
      goal_type: 'recomp',
      pace_kg_per_week: 0.5, // intentionally non-zero, must be ignored
    });
    expect(result.baseline).toBe(1620);
    expect(result.daily_kcal_delta).toBe(0);
    expect(result.floor_applied).toBe(false);
  });
});

describe('goalService.computeDynamicBaseline — invariants', () => {
  test('floor differs by sex (1400 male / 1200 female)', () => {
    const male = goalService.computeDynamicBaseline({
      sex_at_birth: 'male', age_years: 30, height_cm: 180, weight_kg: 80,
      goal_type: 'lose', pace_kg_per_week: -1.5,
    });
    const female = goalService.computeDynamicBaseline({
      sex_at_birth: 'female', age_years: 30, height_cm: 165, weight_kg: 60,
      goal_type: 'lose', pace_kg_per_week: -1.5,
    });
    expect(male.floor).toBe(1400);
    expect(female.floor).toBe(1200);
  });

  test('uses sedentary multiplier 1.2, not v2 NEAT multipliers', () => {
    // Same inputs through both: dynamic baseline must be lower than v2
    // calorie target (which adds NEAT for activity_level + EAT for workouts).
    const inputs = {
      sex_at_birth: 'male', age_years: 30, height_cm: 180, weight_kg: 80,
      goal_type: 'maintain', pace_kg_per_week: 0,
      activity_level: 'active', workouts_per_week: 3, avg_workout_duration_min: 45, avg_workout_intensity: 'moderate',
    };
    const dyn = goalService.computeDynamicBaseline(inputs);
    const v2 = goalService.computeTargetsV2(inputs);
    expect(dyn.baseline).toBeLessThan(v2.calorie_target);
    // Sanity: BMR×1.2 should match sedentary_tdee.
    expect(dyn.sedentary_tdee).toBe(Math.round(dyn.rmr * 1.2));
  });

  test('throws when required field is missing', () => {
    expect(() =>
      goalService.computeDynamicBaseline({
        sex_at_birth: 'male', age_years: 30, height_cm: 180, weight_kg: 80,
        // missing goal_type
        pace_kg_per_week: 0,
      })
    ).toThrow(/Missing required field/);
  });
});
