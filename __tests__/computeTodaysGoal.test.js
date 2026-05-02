// Tests for goalService.computeTodaysGoal (CAL-23).
//
// today's_goal = baselineGoal + activity_bonus
// where activity_bonus = step_bonus + workout_bonus, capped at 50% of
// baselineGoal.
//
//   step_bonus    = netSteps × STEP_COEF (0.05 kcal/step)
//   workout_bonus = Σ kcal × WORKOUT_HAIRCUT (0.5)
//
// CAL-23 follow-up: BMR-during-workout subtraction was removed in favor of
// a flat 50% haircut on raw calories burned. The simpler "half of what you
// burn" model matches user mental model and avoids the HealthKit
// active-vs-total double-subtraction bug. Source asymmetry between manual
// (MET-based, total energy) and HealthKit (active energy, net of BMR) is
// ~30-50 kcal per workout — well under the noise of MET tables and Apple's
// energy estimates.

const goalService = require('../services/goalService');

describe('goalService.computeTodaysGoal — CAL-23 daily flex', () => {
  // Reference user: 1900 baseline, RMR 1500 kcal/day → 1.0417 kcal/min at rest.
  // Cap = 950.
  const baseUser = { baselineGoal: 1900, rmrPerDay: 1500 };

  test('zero activity → bonus is zero, todaysGoal === baselineGoal', () => {
    const result = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 0,
      workouts: []
    });
    expect(result.stepBonus).toBe(0);
    expect(result.workoutBonus).toBe(0);
    expect(result.bonusApplied).toBe(0);
    expect(result.capped).toBe(false);
    expect(result.todaysGoal).toBe(1900);
    expect(result.breakdown.netSteps).toBe(0);
    expect(result.breakdown.workouts).toEqual([]);
  });

  test('steps-only day → step_bonus = steps × 0.05', () => {
    const result = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 6000,
      workouts: []
    });
    expect(result.stepBonus).toBe(300);
    expect(result.workoutBonus).toBe(0);
    expect(result.bonusApplied).toBe(300);
    expect(result.todaysGoal).toBe(2200);
    expect(result.capped).toBe(false);
  });

  test('workout-only day → workout_bonus = kcal × 0.5', () => {
    // 30-min workout @ 250 kcal. Contribution = 250 × 0.5 = 125.
    const result = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 0,
      workouts: [{ calories_burned: 250, duration_min: 30 }]
    });
    expect(result.stepBonus).toBe(0);
    expect(result.workoutBonus).toBe(125);
    expect(result.todaysGoal).toBe(2025); // 1900 + 125 = 2025
    expect(result.capped).toBe(false);
    expect(result.breakdown.workouts).toHaveLength(1);
    expect(result.breakdown.workouts[0]).toMatchObject({
      kcal_burned: 250,
      duration_min: 30,
      contribution: 125
    });
    // bmr_during / net_kcal removed — formula no longer uses BMR.
    expect(result.breakdown.workouts[0].bmr_during).toBeUndefined();
    expect(result.breakdown.workouts[0].net_kcal).toBeUndefined();
  });

  test('cap-binding extreme day → bonusApplied = 0.5 × baselineGoal, capped=true', () => {
    // 30000 steps → 1500 kcal step bonus alone, well past the 950 cap.
    const result = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 30000,
      workouts: [{ calories_burned: 800, duration_min: 60 }]
    });
    expect(result.stepBonus).toBe(1500);
    expect(result.bonusUncapped).toBeGreaterThan(950);
    expect(result.capped).toBe(true);
    expect(result.bonusApplied).toBe(950); // 0.5 × 1900
    expect(result.todaysGoal).toBe(2850); // 1900 + 950
  });

  test('manual workout → identical to non-manual when payload shape matches', () => {
    // CAL-23 reads workouts from ActivityStore EXERCISE, where manual
    // entries land via exerciseService with the same {calories_burned,
    // duration_min} fields. The pure function has no source-aware branch.
    const apple = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 0,
      workouts: [{ calories_burned: 300, duration_min: 45, source: 'apple_health' }]
    });
    const manual = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 0,
      workouts: [{ calories_burned: 300, duration_min: 45, source: 'manual' }]
    });
    expect(apple).toEqual(manual);
  });

  test('workout-window step dedup — gross daily steps flow through (gap documented)', () => {
    // ActivityStore stores only daily total steps per source — no intraday
    // breakdown and no per-workout step counts — so PRD §7.4's "exclude
    // workout-window steps" dedup isn't directly computable. CAL-23 ships
    // with gross daily steps; the 50% cap bounds the impact. This test
    // encodes the current contract so a regression flips here if/when
    // dedup is added.
    const result = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 8000, // gross — we're NOT subtracting workout-window steps
      workouts: [{ calories_burned: 250, duration_min: 30 }]
    });
    // step_bonus reflects all 8000 steps, even though some happened during
    // the workout window.
    expect(result.stepBonus).toBe(400);
    expect(result.breakdown.netSteps).toBe(8000);
  });

  test('idempotent — same inputs always produce same output', () => {
    const inputs = {
      ...baseUser,
      netSteps: 5000,
      workouts: [
        { calories_burned: 300, duration_min: 30 },
        { calories_burned: 150, duration_min: 20 }
      ]
    };
    const a = goalService.computeTodaysGoal(inputs);
    const b = goalService.computeTodaysGoal(inputs);
    expect(a).toEqual(b);
  });

  test('low-kcal workout still credits half — no BMR clamp', () => {
    // 60-min activity reporting 50 kcal. Pre-CAL-23-followup this clamped
    // to 0 because BMR-during exceeded the kcal. Now: 50 × 0.5 = 25.
    const result = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 0,
      workouts: [{ calories_burned: 50, duration_min: 60 }]
    });
    expect(result.workoutBonus).toBe(25);
    expect(result.bonusApplied).toBe(25);
    expect(result.todaysGoal).toBe(1925); // 1900 + 25
  });

  test('multiple workouts sum correctly', () => {
    const result = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 0,
      workouts: [
        { calories_burned: 250, duration_min: 30 }, // contribution 125
        { calories_burned: 400, duration_min: 45 }  // contribution 200
      ]
    });
    expect(result.workoutBonus).toBe(325); // 125 + 200
    expect(result.breakdown.workouts).toHaveLength(2);
  });

  test('non-finite inputs in workout array → contribute 0', () => {
    const result = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 1000,
      workouts: [
        { calories_burned: NaN, duration_min: 30 },
        { calories_burned: 200, duration_min: undefined },
        null
      ]
    });
    expect(result.workoutBonus).toBe(0);
    expect(result.stepBonus).toBe(50);
    expect(result.todaysGoal).toBe(1950);
  });

  test('throws on invalid baselineGoal or rmrPerDay', () => {
    expect(() => goalService.computeTodaysGoal({
      baselineGoal: 0, rmrPerDay: 1500, netSteps: 0, workouts: []
    })).toThrow(/baselineGoal/);
    expect(() => goalService.computeTodaysGoal({
      baselineGoal: 1900, rmrPerDay: NaN, netSteps: 0, workouts: []
    })).toThrow(/rmrPerDay/);
  });

  test('todaysGoal rounds to nearest 5 (display grid alignment)', () => {
    // 4321 steps × 0.05 = 216.05 → rounds to 216. 1900 + 216 = 2116 →
    // round to 5 = 2115.
    const result = goalService.computeTodaysGoal({
      ...baseUser,
      netSteps: 4321,
      workouts: []
    });
    expect(result.todaysGoal % 5).toBe(0);
    expect(result.todaysGoal).toBe(2115);
  });
});
