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
//
// Note on Example 3: PRD §12 lists baseline 2246, but the algorithm
// rounds to nearest 5 (so all four choice-screen numbers share a display
// grid with the round-25 static value). Real result is 2245 — within
// 1 kcal of the PRD figure. PR review fix.

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

  test('Example 3: 75kg man, gain 0.25%/wk → baseline 2245 (PRD says 2246; rounded to nearest 5)', () => {
    // Need BMR≈1699.79 (so BMR×1.2 + 206.25 = 2245.995). Male:
    // 6.25H - 5A = 944.79. age=30 → H=175.166. round_to_5(2245.995) = 2245.
    const result = goalService.computeDynamicBaseline({
      sex_at_birth: 'male',
      age_years: 30,
      height_cm: 175.166,
      weight_kg: 75,
      goal_type: 'gain',
      pace_kg_per_week: 0.1875, // 0.25% × 75kg
    });
    expect(result.baseline).toBe(2245);
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

  test('uses sedentary multiplier 1.2 (independent of v2 activity-band path)', () => {
    // The dynamic baseline path is fixed at BMR×1.2; v2 uses ACTIVITY_MULTIPLIERS
    // and produces a higher number for any band above sedentary. Compare against
    // moderately_active (1.55) — the v2 default for the static fallback.
    const inputs = {
      sex_at_birth: 'male', age_years: 30, height_cm: 180, weight_kg: 80,
      goal_type: 'maintain', pace_kg_per_week: 0,
      activity_level: 'moderately_active',
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
