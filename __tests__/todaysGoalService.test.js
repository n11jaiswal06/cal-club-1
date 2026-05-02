// Orchestrator-level tests for todaysGoalService.buildTodaysGoal (CAL-23).
//
// Pure-function tests for computeTodaysGoal live in computeTodaysGoal.test.js.
// This suite covers the branching the orchestrator owns:
//   • static users / pre-rollout dynamic users return null
//   • SUMMARY/EXERCISE docs flow through into the pure-function inputs
//   • manual workouts (source='manual' on ActivityStore) are not
//     treated specially — they share the EXERCISE shape and dedup path
//   • duration_min fallback from start_time/end_time when missing

const mongoose = require('mongoose');

// Mock ActivityStoreService BEFORE requiring the orchestrator so the
// require-time binding picks up the mock.
jest.mock('../services/activityStoreService', () => ({
  fetch: jest.fn()
}));

const ActivityStoreService = require('../services/activityStoreService');
const { buildTodaysGoal, buildTodaysMacros, sumDailySteps, flattenWorkouts } = require('../services/todaysGoalService');

function makeUser(overrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    goals: {
      goalType: 'dynamic',
      baselineGoal: 1900,
      rmr: 1500,
      ...overrides
    }
  };
}

beforeEach(() => {
  ActivityStoreService.fetch.mockReset();
  // Default: no activity (both fetches return empty arrays).
  ActivityStoreService.fetch.mockResolvedValue([]);
});

describe('todaysGoalService.buildTodaysGoal — gating', () => {
  test('static user → null (no dynamicGoal block)', async () => {
    const user = makeUser({ goalType: 'static' });
    const result = await buildTodaysGoal(user, '2026-05-01');
    expect(result).toBeNull();
    expect(ActivityStoreService.fetch).not.toHaveBeenCalled();
  });

  test('dynamic user missing rmr (pre-rollout) → null', async () => {
    const user = makeUser({ rmr: undefined });
    const result = await buildTodaysGoal(user, '2026-05-01');
    expect(result).toBeNull();
    expect(ActivityStoreService.fetch).not.toHaveBeenCalled();
  });

  test('dynamic user missing baselineGoal → null', async () => {
    const user = makeUser({ baselineGoal: undefined });
    const result = await buildTodaysGoal(user, '2026-05-01');
    expect(result).toBeNull();
  });

  test('dynamic user with rmr=0 → null (defensive)', async () => {
    const user = makeUser({ rmr: 0 });
    const result = await buildTodaysGoal(user, '2026-05-01');
    expect(result).toBeNull();
  });

  test('null/undefined user → null', async () => {
    expect(await buildTodaysGoal(null, '2026-05-01')).toBeNull();
    expect(await buildTodaysGoal(undefined, '2026-05-01')).toBeNull();
  });
});

describe('todaysGoalService.buildTodaysGoal — happy path', () => {
  test('zero activity → todaysGoal === baselineGoal', async () => {
    const user = makeUser();
    const result = await buildTodaysGoal(user, '2026-05-01');
    expect(result).toMatchObject({
      baselineGoal: 1900,
      stepBonus: 0,
      workoutBonus: 0,
      bonusApplied: 0,
      capped: false,
      todaysGoal: 1900
    });
  });

  test('SUMMARY steps flow through to step bonus', async () => {
    const user = makeUser();
    ActivityStoreService.fetch.mockImplementation((_uid, _date, opts) => {
      if (opts.category === 'SUMMARY') {
        return Promise.resolve([
          { source: 'apple_health', data: [{ activity_type: 'STEPS', value: 6000 }] }
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await buildTodaysGoal(user, '2026-05-01');
    expect(result.stepBonus).toBe(300); // 6000 × 0.05
    expect(result.todaysGoal).toBe(2200);
  });

  test('EXERCISE workouts flow through; manual workout has no special path', async () => {
    const user = makeUser();
    ActivityStoreService.fetch.mockImplementation((_uid, _date, opts) => {
      if (opts.category === 'EXERCISE') {
        return Promise.resolve([
          {
            source: 'manual',
            data: [{ calories_burned: 250, duration_min: 30, log_id: 'abc' }]
          }
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await buildTodaysGoal(user, '2026-05-01');
    // 250 × 0.5 = 125 (no BMR subtraction; CAL-23 follow-up)
    expect(result.workoutBonus).toBe(125);
    expect(result.breakdown.workouts).toHaveLength(1);
    expect(result.breakdown.workouts[0].kcal_burned).toBe(250);
  });

  test('combined steps + workout flow into final todaysGoal', async () => {
    const user = makeUser();
    ActivityStoreService.fetch.mockImplementation((_uid, _date, opts) => {
      if (opts.category === 'SUMMARY') {
        return Promise.resolve([{ source: 'apple_health', data: [{ activity_type: 'STEPS', value: 4000 }] }]);
      }
      if (opts.category === 'EXERCISE') {
        return Promise.resolve([{ source: 'apple_health', data: [{ calories_burned: 250, duration_min: 30 }] }]);
      }
      return Promise.resolve([]);
    });
    const result = await buildTodaysGoal(user, '2026-05-01');
    expect(result.stepBonus).toBe(200);
    expect(result.workoutBonus).toBe(125);
    expect(result.todaysGoal).toBe(2225); // 1900 + 200 + 125 = 2225
    expect(result.capped).toBe(false);
  });

  test('multiple SUMMARY sources sum together (existing pattern caveat)', async () => {
    // Mirrors exerciseBurnWidgetService — both Apple and Google contribute.
    // Documented as a multi-source double-count caveat; test encodes
    // current behaviour so a regression flips here.
    const user = makeUser();
    ActivityStoreService.fetch.mockImplementation((_uid, _date, opts) => {
      if (opts.category === 'SUMMARY') {
        return Promise.resolve([
          { source: 'apple_health', data: [{ activity_type: 'STEPS', value: 3000 }] },
          { source: 'google_health_connect', data: [{ activity_type: 'STEPS', value: 2000 }] }
        ]);
      }
      return Promise.resolve([]);
    });
    const result = await buildTodaysGoal(user, '2026-05-01');
    expect(result.breakdown.netSteps).toBe(5000);
    expect(result.stepBonus).toBe(250);
  });
});

describe('todaysGoalService — pure helpers', () => {
  test('sumDailySteps ignores non-STEPS items and parses string values', () => {
    const docs = [
      { data: [
        { activity_type: 'STEPS', value: 1000 },
        { activity_type: 'CALORIES', value: 500 },         // ignored
        { activity_type: 'STEPS', value: '2000' },          // string parsed
        { activity_type: 'STEPS', value: 'not-a-number' }   // ignored
      ]}
    ];
    expect(sumDailySteps(docs)).toBe(3000);
  });

  test('sumDailySteps handles empty/missing docs', () => {
    expect(sumDailySteps(null)).toBe(0);
    expect(sumDailySteps([])).toBe(0);
    expect(sumDailySteps([{ data: null }])).toBe(0);
  });

  test('flattenWorkouts derives duration_min from start_time/end_time when missing', () => {
    // 30-minute workout: end - start = 30 × 60000 ms.
    const start = 1700000000000;
    const end = start + 30 * 60000;
    const docs = [
      { data: [{ calories_burned: 250, start_time: start, end_time: end }] }
    ];
    const workouts = flattenWorkouts(docs);
    expect(workouts).toEqual([{ calories_burned: 250, duration_min: 30 }]);
  });

  test('flattenWorkouts: missing duration AND timestamps → duration 0 (workout still surfaces)', () => {
    // computeTodaysGoal will skip this entry (Number.isFinite(0) === true so
    // it survives the orchestrator filter, but BMR-during=0 then net=full
    // kcal). Documented: duration-less entries are best-effort.
    const docs = [{ data: [{ calories_burned: 100 }] }];
    const workouts = flattenWorkouts(docs);
    expect(workouts).toEqual([{ calories_burned: 100, duration_min: 0 }]);
  });

  test('flattenWorkouts handles empty docs', () => {
    expect(flattenWorkouts(null)).toEqual([]);
    expect(flattenWorkouts([])).toEqual([]);
    expect(flattenWorkouts([{ data: null }])).toEqual([]);
  });

  // CAL-23 follow-up: HealthKit-sourced workouts populate active_calories /
  // total_calories instead of calories_burned. Without the fallback, the
  // home-tile workoutBonus silently dropped to 0 even when the burn widget
  // (different parser) showed the workout. Mirror exerciseBurnWidgetService
  // so the two surfaces never disagree on whether a workout exists.
  test('flattenWorkouts: HealthKit item (active_calories only) used as calories_burned', () => {
    const docs = [{
      data: [{
        active_calories: 435,
        total_calories: 416,
        duration_min: 81,
        exercise_type: 'TRADITIONAL_STRENGTH_TRAINING',
      }]
    }];
    const workouts = flattenWorkouts(docs);
    expect(workouts).toEqual([{ calories_burned: 435, duration_min: 81 }]);
  });

  test('flattenWorkouts: calories_burned wins over active_calories / total_calories', () => {
    const docs = [{
      data: [{
        calories_burned: 300,
        active_calories: 400,
        total_calories: 350,
        duration_min: 30,
      }]
    }];
    const workouts = flattenWorkouts(docs);
    expect(workouts[0].calories_burned).toBe(300);
  });

  test('flattenWorkouts: total_calories used when calories_burned and active_calories absent', () => {
    const docs = [{
      data: [{ total_calories: 200, duration_min: 25 }]
    }];
    const workouts = flattenWorkouts(docs);
    expect(workouts[0].calories_burned).toBe(200);
  });

  test('flattenWorkouts: all calorie fields missing → 0 (worker still surfaces, computeTodaysGoal skips)', () => {
    const docs = [{ data: [{ duration_min: 30 }] }];
    const workouts = flattenWorkouts(docs);
    expect(workouts[0].calories_burned).toBe(0);
  });
});

// CAL-44: per-day macro orchestrator. Mirrors buildTodaysGoal's "null on
// static / missing fields" contract so the format layer can fall back to
// flat persisted goals without a try/catch.
describe('todaysGoalService.buildTodaysMacros — gating', () => {
  function makeRecipeUser(overrides = {}) {
    return {
      _id: new mongoose.Types.ObjectId(),
      goals: {
        goalType: 'dynamic',
        weightKg: 70,
        weightGoalType: 'lose',
        proteinGramsPerKg: 2.0,
        fatPctFloor: 0.25,
        fatGramsPerKgFloor: 0.6,
        ...overrides
      }
    };
  }

  test('static user → null', () => {
    const user = makeRecipeUser({ goalType: 'static' });
    expect(buildTodaysMacros(user, 2000)).toBeNull();
  });

  test('null user → null', () => {
    expect(buildTodaysMacros(null, 2000)).toBeNull();
    expect(buildTodaysMacros(undefined, 2000)).toBeNull();
  });

  test('dynamic user missing weightKg → null (recipe incomplete)', () => {
    const user = makeRecipeUser({ weightKg: undefined });
    expect(buildTodaysMacros(user, 2000)).toBeNull();
  });

  test('dynamic user missing proteinGramsPerKg → null', () => {
    const user = makeRecipeUser({ proteinGramsPerKg: undefined });
    expect(buildTodaysMacros(user, 2000)).toBeNull();
  });

  test('dynamic user missing fatPctFloor → null', () => {
    const user = makeRecipeUser({ fatPctFloor: undefined });
    expect(buildTodaysMacros(user, 2000)).toBeNull();
  });

  test('todaysGoal missing → null', () => {
    const user = makeRecipeUser();
    expect(buildTodaysMacros(user, undefined)).toBeNull();
    expect(buildTodaysMacros(user, 0)).toBeNull();
  });

  test('fatGramsPerKgFloor missing → falls back to 0.6 (legacy users)', () => {
    const user = makeRecipeUser({ fatGramsPerKgFloor: undefined });
    const result = buildTodaysMacros(user, 1540);
    expect(result).not.toBeNull();
    // Same as ticket sedentary day with 0.6 floor: protein 140, fat 43, carbs 149.
    expect(result.protein.goal_g).toBe(140);
    expect(result.fat.goal_g).toBe(43);
    expect(result.carbs.goal_g).toBe(149);
  });
});

describe('todaysGoalService.buildTodaysMacros — happy path', () => {
  function makeRecipeUser(overrides = {}) {
    return {
      _id: new mongoose.Types.ObjectId(),
      goals: {
        goalType: 'dynamic',
        weightKg: 70,
        weightGoalType: 'lose',
        proteinGramsPerKg: 2.0,
        fatPctFloor: 0.25,
        fatGramsPerKgFloor: 0.6,
        ...overrides
      }
    };
  }

  test('ticket sedentary (todaysGoal=1540) → 140p / 43f / 149c', () => {
    const user = makeRecipeUser();
    const result = buildTodaysMacros(user, 1540);
    expect(result).toEqual({
      protein: { goal_g: 140, goal_kcal: 560 },
      fat:     { goal_g: 43,  goal_kcal: 385 },
      carbs:   { goal_g: 149, goal_kcal: 595 }
    });
  });

  test('ticket active (todaysGoal=2310) → 140p / 64f / 293c', () => {
    const user = makeRecipeUser();
    const result = buildTodaysMacros(user, 2310);
    expect(result.protein.goal_g).toBe(140);            // protein invariant
    expect(result.fat.goal_g).toBe(64);
    // ticket approximated as ~280; actual residual = (2310-560-577.5)/4 = 293
    expect(result.carbs.goal_g).toBe(293);
  });

  test('shape — each macro returns {goal_g, goal_kcal} only', () => {
    const result = buildTodaysMacros(makeRecipeUser(), 2000);
    expect(Object.keys(result)).toEqual(['protein', 'fat', 'carbs']);
    expect(Object.keys(result.protein)).toEqual(['goal_g', 'goal_kcal']);
  });
});
