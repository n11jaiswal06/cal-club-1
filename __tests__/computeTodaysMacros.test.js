// Tests for goalService.computeTodaysMacros (CAL-44).
//
// Per-day macro split for dynamic users:
//   protein_g  = protein_factor × weight_kg            (invariant)
//   fat_kcal   = max(fat_pct × todaysGoal, 9 × g_per_kg_floor × weight_kg)
//   fat_g      = fat_kcal / 9
//   carb_g     = max(0, todaysGoal − protein_kcal − fat_kcal) / 4
//
// Returns null on invalid inputs (mirrors orchestrator-friendly contract);
// callers fall back to flat persisted dailyProtein/Fats/Carbs.

const goalService = require('../services/goalService');

describe('goalService.computeTodaysMacros — CAL-44 per-day macro split', () => {
  // Ticket reference user: 70 kg, 'lose' goal type → factor 2.0 protein,
  // 25% fat. Sedentary day (todaysGoal = 1540) and active day (2310)
  // demonstrate the residual-carbs scaling.
  const loseUser = {
    weight_kg: 70,
    protein_factor: 2.0,
    fat_pct_floor: 0.25,
    fat_g_per_kg_floor: 0.6
  };

  test('ticket sedentary day (todaysGoal=1540) → protein 140 / fat 43 / carbs ~148', () => {
    const result = goalService.computeTodaysMacros({ ...loseUser, todaysGoal: 1540 });
    expect(result.protein_g).toBe(140);                 // 2.0 × 70
    // fat_pct path wins: 0.25 × 1540 = 385 kcal vs floor 9 × 0.6 × 70 = 378 kcal
    expect(result.fat_g).toBe(43);                      // 385 / 9 ≈ 42.78 → 43
    // carbs = (1540 − 560 − 385) / 4 = 148.75 → 149
    expect(result.carb_g).toBe(149);
  });

  test('ticket active day (todaysGoal=2310) → protein 140 / fat 64 / carbs 293', () => {
    const result = goalService.computeTodaysMacros({ ...loseUser, todaysGoal: 2310 });
    expect(result.protein_g).toBe(140);                 // invariant
    expect(result.fat_g).toBe(64);                      // 0.25 × 2310 / 9 = 64.17
    // ticket approximated this as ~280; actual residual is
    // (2310 − 560 − 577.5) / 4 = 293.125 → 293
    expect(result.carb_g).toBe(293);
  });

  test('protein invariance — same weight, different todaysGoal → same protein', () => {
    const a = goalService.computeTodaysMacros({ ...loseUser, todaysGoal: 1540 });
    const b = goalService.computeTodaysMacros({ ...loseUser, todaysGoal: 2310 });
    expect(a.protein_g).toBe(b.protein_g);
  });

  test('fat g/kg floor activates when fat_pct × todaysGoal goes below it', () => {
    // 0.25 × 1200 = 300 kcal; floor 9 × 0.6 × 70 = 378 kcal — floor wins.
    const result = goalService.computeTodaysMacros({ ...loseUser, todaysGoal: 1200 });
    expect(result.fat_kcal).toBe(378);
    expect(result.fat_g).toBe(42);                      // 378 / 9
  });

  describe('goal_type table cases', () => {
    const weight = 70;

    test('maintain (1.6, 0.30) → 112p, fat 30%', () => {
      const result = goalService.computeTodaysMacros({
        weight_kg: weight,
        protein_factor: 1.6,
        fat_pct_floor: 0.30,
        todaysGoal: 2200
      });
      expect(result.protein_g).toBe(112);
      // 0.30 × 2200 = 660 vs floor 378 → fat_pct wins
      expect(result.fat_g).toBe(73);                    // 660/9 ≈ 73.33
    });

    test('gain (2.2, 0.25)', () => {
      const result = goalService.computeTodaysMacros({
        weight_kg: weight,
        protein_factor: 2.2,
        fat_pct_floor: 0.25,
        todaysGoal: 2800
      });
      expect(result.protein_g).toBe(154);
      expect(result.fat_g).toBe(78);                    // 0.25 × 2800 / 9
    });

    test('recomp (2.0, 0.30)', () => {
      const result = goalService.computeTodaysMacros({
        weight_kg: weight,
        protein_factor: 2.0,
        fat_pct_floor: 0.30,
        todaysGoal: 2000
      });
      expect(result.protein_g).toBe(140);
      expect(result.fat_g).toBe(67);                    // 0.30 × 2000 / 9 ≈ 66.67
    });
  });

  describe('invalid inputs return null (orchestrator-friendly)', () => {
    test('todaysGoal missing', () => {
      expect(goalService.computeTodaysMacros({ ...loseUser })).toBeNull();
    });
    test('todaysGoal zero', () => {
      expect(goalService.computeTodaysMacros({ ...loseUser, todaysGoal: 0 })).toBeNull();
    });
    test('weight_kg missing', () => {
      const { weight_kg, ...rest } = loseUser;
      expect(goalService.computeTodaysMacros({ ...rest, todaysGoal: 1900 })).toBeNull();
    });
    test('protein_factor missing', () => {
      const { protein_factor, ...rest } = loseUser;
      expect(goalService.computeTodaysMacros({ ...rest, todaysGoal: 1900 })).toBeNull();
    });
    test('fat_pct_floor missing', () => {
      const { fat_pct_floor, ...rest } = loseUser;
      expect(goalService.computeTodaysMacros({ ...rest, todaysGoal: 1900 })).toBeNull();
    });
  });

  test('carbs clamp at 0 — pathological todaysGoal (protein + fat exceed it)', () => {
    // 70 kg lose user, todaysGoal = 700. protein 560 kcal + fat floor 378 = 938 > 700.
    // Result: carbs clamp to 0, no negative.
    const result = goalService.computeTodaysMacros({ ...loseUser, todaysGoal: 700 });
    expect(result.carb_g).toBe(0);
    expect(result.carb_kcal).toBe(0);
  });

  test('default fat_g_per_kg_floor = 0.6 when omitted', () => {
    const a = goalService.computeTodaysMacros({
      weight_kg: 70,
      protein_factor: 2.0,
      fat_pct_floor: 0.25,
      todaysGoal: 1200
      // fat_g_per_kg_floor omitted
    });
    const b = goalService.computeTodaysMacros({
      weight_kg: 70,
      protein_factor: 2.0,
      fat_pct_floor: 0.25,
      fat_g_per_kg_floor: 0.6,
      todaysGoal: 1200
    });
    expect(a).toEqual(b);
  });
});

describe('goalService.calculateAdaptiveMacros — delegates to computeTodaysMacros', () => {
  // Refactor sanity — pre-CAL-44 callers (computeTargetsV2) keep working.
  test('lose @ 2000 kcal × 70 kg → 140p / fat 56 / carbs 220', () => {
    const result = goalService.calculateAdaptiveMacros({
      calorie_target: 2000,
      weight_kg: 70,
      goal_type: 'lose'
    });
    expect(result.protein_g).toBe(140);
    expect(result.fat_g).toBe(56);                      // 0.25 × 2000 / 9 ≈ 55.56
    // carbs = (2000 − 560 − 500) / 4 = 235
    expect(result.carb_g).toBe(235);
  });

  test('unknown goal_type falls back to maintain', () => {
    const result = goalService.calculateAdaptiveMacros({
      calorie_target: 2000,
      weight_kg: 70,
      goal_type: 'nonsense'
    });
    // maintain: 1.6 × 70 = 112 protein
    expect(result.protein_g).toBe(112);
  });
});

describe('goalService.MACRO_CONFIGS — exported config table', () => {
  test('has all four goal types with the expected coefficients', () => {
    expect(goalService.MACRO_CONFIGS).toEqual({
      lose:     { protein_factor: 2.0, fat_pct: 0.25 },
      maintain: { protein_factor: 1.6, fat_pct: 0.30 },
      gain:     { protein_factor: 2.2, fat_pct: 0.25 },
      recomp:   { protein_factor: 2.0, fat_pct: 0.30 }
    });
  });
});
