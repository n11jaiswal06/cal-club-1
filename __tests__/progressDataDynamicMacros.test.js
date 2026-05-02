// CAL-44: /app/progress dailyGoal block — for dynamic users with the
// recipe persisted, calorie/protein/carbs/fats reflect today's per-day
// numbers (matching the home tile). For static users and recipe-less
// dynamic users, dailyGoal stays on the flat persisted values.

const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');

const User = require('../models/schemas/User');
const UserLog = require('../models/schemas/UserLog');

// Stub buildTodaysGoal so we can inject a fixed todaysGoal without
// having to populate ActivityStore. buildTodaysMacros is synchronous
// and reads user.goals only — leaving it un-mocked exercises the real
// recipe → macros pipeline through to the response.
jest.mock('../services/todaysGoalService', () => {
  const actual = jest.requireActual('../services/todaysGoalService');
  return {
    ...actual,
    buildTodaysGoal: jest.fn()
  };
});

const { buildTodaysGoal } = require('../services/todaysGoalService');
const AppFormatService = require('../services/appFormatService');

beforeAll(async () => {
  await setupMongoServer();
  await User.init();
});

afterAll(async () => {
  await teardownMongoServer();
});

beforeEach(() => {
  buildTodaysGoal.mockReset();
});

afterEach(async () => {
  await clearAllCollections();
});

async function seedDynamicUser({ withRecipe = true } = {}) {
  const goals = {
    dailyCalories: 2100,
    dailyProtein: 150,
    dailyCarbs: 255,
    dailyFats: 60,
    goalType: 'dynamic',
    intent: 'dynamic',
    outcome: 'dynamic',
    baselineGoal: 1540,
    rmr: 1500,
    ...(withRecipe ? {
      weightKg: 70,
      weightGoalType: 'lose',
      proteinGramsPerKg: 2.0,
      fatPctFloor: 0.25,
      fatGramsPerKgFloor: 0.6
    } : {})
  };
  return User.create({ phone: '+15551234599', name: 'Dynamic Test', goals });
}

async function seedStaticUser() {
  return User.create({
    phone: '+15551234600',
    name: 'Static Test',
    goals: {
      dailyCalories: 2100, dailyProtein: 150, dailyCarbs: 255, dailyFats: 60,
      goalType: 'static', intent: 'static', outcome: 'static_chosen',
      baselineGoal: 2100
    }
  });
}

async function seedWeightLog(userId, value, date) {
  return UserLog.create({ userId, type: 'WEIGHT', value: String(value), unit: 'kg', date });
}

describe('getProgressData — CAL-44 dynamic dailyGoal scaling', () => {
  test('dynamic user with recipe → dailyGoal reflects today\'s per-day numbers', async () => {
    const user = await seedDynamicUser();
    await seedWeightLog(user._id, 70, '2026-04-01');
    buildTodaysGoal.mockResolvedValue({
      baselineGoal: 1540, todaysGoal: 1540, stepBonus: 0, workoutBonus: 0,
      bonusApplied: 0, capped: false, breakdown: { netSteps: 0, workouts: [] }
    });

    const data = await AppFormatService.getProgressData(user._id);

    // Per-day macros for the ticket's sedentary day (todaysGoal=1540, lose, 70kg):
    // protein 140, fat 43, carbs 149.
    expect(data.dailyGoal).toEqual({
      calorie: 1540,
      protein: 140,
      carbs: 149,
      fats: 43
    });
    // Persisted flat numbers (255 carbs, 60 fat) intentionally do NOT
    // surface here for dynamic users with the recipe.
    expect(data.dailyGoal.carbs).not.toBe(255);
  });

  test('dynamic user, active day (higher todaysGoal) → carbs scale up, protein invariant', async () => {
    const user = await seedDynamicUser();
    await seedWeightLog(user._id, 70, '2026-04-01');
    buildTodaysGoal.mockResolvedValue({
      baselineGoal: 1540, todaysGoal: 2310, stepBonus: 770, workoutBonus: 0,
      bonusApplied: 770, capped: false, breakdown: { netSteps: 15400, workouts: [] }
    });

    const data = await AppFormatService.getProgressData(user._id);
    expect(data.dailyGoal.calorie).toBe(2310);
    expect(data.dailyGoal.protein).toBe(140);            // invariant
    expect(data.dailyGoal.carbs).toBe(293);              // residual scales
    expect(data.dailyGoal.fats).toBe(64);
  });

  test('dynamic user without recipe → dailyGoal falls back to flat persisted values', async () => {
    const user = await seedDynamicUser({ withRecipe: false });
    await seedWeightLog(user._id, 70, '2026-04-01');
    buildTodaysGoal.mockResolvedValue({
      baselineGoal: 1540, todaysGoal: 1540, stepBonus: 0, workoutBonus: 0,
      bonusApplied: 0, capped: false, breakdown: { netSteps: 0, workouts: [] }
    });

    const data = await AppFormatService.getProgressData(user._id);
    // calorie still uses todaysGoal (the dynamicGoal block is non-null);
    // macros fall back to flat persisted values since recipe is missing.
    expect(data.dailyGoal.calorie).toBe(1540);
    expect(data.dailyGoal.protein).toBe(150);
    expect(data.dailyGoal.carbs).toBe(255);
    expect(data.dailyGoal.fats).toBe(60);
  });

  test('static user → dailyGoal stays on flat persisted values, byte-identical to pre-CAL-44', async () => {
    const user = await seedStaticUser();
    await seedWeightLog(user._id, 70, '2026-04-01');
    buildTodaysGoal.mockResolvedValue(null);             // null for static

    const data = await AppFormatService.getProgressData(user._id);
    expect(data.dailyGoal).toEqual({
      calorie: 2100,
      protein: 150,
      carbs: 255,
      fats: 60
    });
    expect(data.dynamicGoal).toBeUndefined();
  });
});
