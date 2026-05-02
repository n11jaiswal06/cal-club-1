// CAL-44: POST /goals/calculate-and-save persists the macro recipe +
// weightKg snapshot for dynamic users and echoes a baselineMacros block
// for the plan screen. Static users see no schema or response changes.

const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');

const User = require('../models/schemas/User');
const goalController = require('../controllers/goalController');

jest.mock('../utils/parseBody', () => (req, cb) => cb(null, req._body));

let logSpy, warnSpy, errSpy;

beforeAll(async () => {
  await setupMongoServer();
  await User.init();
});

afterAll(async () => {
  await teardownMongoServer();
});

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errSpy.mockRestore();
  await clearAllCollections();
});

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    writeHead(code) { this.statusCode = code; },
    end(body) { this.body = body; },
  };
  return res;
}

async function seedUser() {
  return User.create({ phone: '+15551234599', name: 'Test CAL-44' });
}

function basePayload(overrides = {}) {
  // Reference user from the ticket: 70 kg, lose, mode=dynamic.
  return {
    sex_at_birth: 'male',
    age_years: 30,
    height_cm: 175,
    weight_kg: 70,
    goal_type: 'lose',
    pace_kg_per_week: 0.5,
    activity_level: 'sedentary',
    desired_weight_kg: 65,
    mode: 'dynamic',
    ...overrides,
  };
}

async function callController(user, body) {
  const req = {
    url: '/goals/calculate-and-save',
    user: { userId: String(user._id) },
    _body: body,
  };
  const res = makeRes();
  await goalController.calculateAndSaveGoals(req, res);
  return { req, res, parsed: res.body ? JSON.parse(res.body) : null };
}

describe('calculateAndSaveGoals — CAL-44 dynamic recipe persistence', () => {
  test('dynamic user: persists weightKg + recipe fields on User.goals', async () => {
    const user = await seedUser();
    const { res } = await callController(user, basePayload());
    expect(res.statusCode).toBe(200);

    const reloaded = await User.findById(user._id).lean();
    expect(reloaded.goals.weightKg).toBe(70);
    expect(reloaded.goals.weightGoalType).toBe('lose');
    expect(reloaded.goals.proteinGramsPerKg).toBe(2.0);
    expect(reloaded.goals.fatPctFloor).toBe(0.25);
    expect(reloaded.goals.fatGramsPerKgFloor).toBe(0.6);
  });

  test('dynamic user: response echoes recipe + baselineMacros block', async () => {
    const user = await seedUser();
    const { parsed } = await callController(user, basePayload());

    expect(parsed.success).toBe(true);
    expect(parsed.data.goalType).toBe('dynamic');
    expect(parsed.data.weightKg).toBe(70);
    expect(parsed.data.weightGoalType).toBe('lose');
    expect(parsed.data.proteinGramsPerKg).toBe(2.0);
    expect(parsed.data.fatPctFloor).toBe(0.25);
    expect(parsed.data.fatGramsPerKgFloor).toBe(0.6);

    // baselineMacros: macros computed at the BMR×1.2 baseline (the
    // sedentary-day floor the dynamic plan screen surfaces). The
    // baseline number itself comes from computeDynamicBaseline so we
    // just assert shape + invariants — protein scales with weight,
    // carbs are non-negative, all four values are positive integers.
    const bm = parsed.data.baselineMacros;
    expect(bm).toBeDefined();
    expect(bm.calories).toBe(parsed.data.baselineGoal);  // same number on both keys
    expect(Number.isInteger(bm.protein)).toBe(true);
    expect(Number.isInteger(bm.fat)).toBe(true);
    expect(Number.isInteger(bm.carbs)).toBe(true);
    expect(bm.protein).toBe(140);                        // 2.0 × 70
    expect(bm.fat).toBeGreaterThan(0);
    expect(bm.carbs).toBeGreaterThanOrEqual(0);
    // protein + fat + carbs kcal stays inside the calorie ceiling
    // (carbs clamp at 0 keeps this true even if protein+fat overshoot).
    const totalKcal = bm.protein * 4 + bm.fat * 9 + bm.carbs * 4;
    expect(totalKcal).toBeLessThanOrEqual(bm.calories + 5);  // ±5 from rounding
  });

  test('different goal_type → different recipe coefficients persisted', async () => {
    const user = await seedUser();
    const { parsed } = await callController(user, basePayload({ goal_type: 'gain' }));
    expect(parsed.data.proteinGramsPerKg).toBe(2.2);     // gain
    expect(parsed.data.fatPctFloor).toBe(0.25);
    expect(parsed.data.baselineMacros.protein).toBe(154); // 2.2 × 70
  });

  test('static user: recipe fields stay unset; no baselineMacros in response', async () => {
    const user = await seedUser();
    const { res, parsed } = await callController(user, basePayload({ mode: 'static' }));
    expect(res.statusCode).toBe(200);

    // Response data — no recipe, no baselineMacros.
    expect(parsed.data.goalType).toBe('static');
    expect(parsed.data.weightKg).toBeUndefined();
    expect(parsed.data.weightGoalType).toBeUndefined();
    expect(parsed.data.proteinGramsPerKg).toBeUndefined();
    expect(parsed.data.fatPctFloor).toBeUndefined();
    expect(parsed.data.fatGramsPerKgFloor).toBeUndefined();
    expect(parsed.data.baselineMacros).toBeUndefined();

    // User doc — recipe fields stay unset (sparse).
    const reloaded = await User.findById(user._id).lean();
    expect(reloaded.goals.weightKg).toBeUndefined();
    expect(reloaded.goals.weightGoalType).toBeUndefined();
    expect(reloaded.goals.proteinGramsPerKg).toBeUndefined();
    expect(reloaded.goals.fatPctFloor).toBeUndefined();
  });
});
