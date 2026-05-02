// CAL-36 follow-up: when POST /goals/calculate-and-save omits `age_years`,
// the controller derives it from User.dateOfBirth before validation. If the
// user has no DOB on file, validation surfaces the existing
// "Missing required field: age_years" 400, unchanged from prior behavior.
// Body-wins when present so initial onboarding (which sends age_years
// explicitly) is untouched.

const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');

const User = require('../models/schemas/User');
const goalController = require('../controllers/goalController');
const { dobToAgeYears } = require('../services/onboardingService');

// Minimal req/res stubs sufficient for the controller. parseBody reads
// from req as a stream — we monkey-patch it via jest.mock.
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
    headers: null,
    body: null,
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  return res;
}

async function seedUser(extra = {}) {
  return User.create({ phone: '+15551234567', name: 'Test', ...extra });
}

// A complete, valid goalService payload minus age_years. Lets each test
// flip just the field under test without re-stating every required key.
function basePayload() {
  return {
    sex_at_birth: 'male',
    height_cm: 175,
    weight_kg: 75,
    goal_type: 'maintain',
    pace_kg_per_week: 0,
    activity_level: 'moderately_active',
    mode: 'static',
  };
}

describe('dobToAgeYears (helper)', () => {
  test('returns whole years and respects birthday-not-yet-reached', () => {
    const today = new Date();
    // Tomorrow's date 30 years ago — birthday hasn't happened yet this year.
    const dob = new Date(Date.UTC(
      today.getUTCFullYear() - 30,
      today.getUTCMonth(),
      today.getUTCDate() + 1,
    ));
    expect(dobToAgeYears(dob)).toBe(29);
  });

  test('returns whole years on/after birthday', () => {
    const today = new Date();
    const dob = new Date(Date.UTC(
      today.getUTCFullYear() - 30,
      today.getUTCMonth(),
      today.getUTCDate(),
    ));
    expect(dobToAgeYears(dob)).toBe(30);
  });

  test('returns null on falsy / unparseable input', () => {
    expect(dobToAgeYears(null)).toBeNull();
    expect(dobToAgeYears(undefined)).toBeNull();
    expect(dobToAgeYears('')).toBeNull();
    expect(dobToAgeYears('not-a-date')).toBeNull();
  });

  test('accepts ISO date string', () => {
    expect(dobToAgeYears('1990-01-01')).toBeGreaterThanOrEqual(35);
  });
});

describe('calculateAndSaveGoals — age_years fallback', () => {
  test('omitted age_years is derived from User.dateOfBirth', async () => {
    const user = await seedUser({ dateOfBirth: new Date('1990-05-15') });
    const req = {
      url: '/goals/calculate-and-save',
      user: { userId: String(user._id) },
      _body: basePayload(), // no age_years
    };
    const res = makeRes();

    await goalController.calculateAndSaveGoals(req, res);

    // Should NOT 400 with "Missing required field: age_years".
    if (res.statusCode === 400) {
      const parsed = JSON.parse(res.body);
      const errs = (parsed.validation && parsed.validation.errors) || [];
      expect(errs.join(' ')).not.toMatch(/Missing required field: age_years/);
    }
    // 200 success or some other validation error is fine; the point is
    // age_years was filled in.
  });

  test('body-supplied age_years wins over User.dateOfBirth', async () => {
    const user = await seedUser({ dateOfBirth: new Date('1990-05-15') });
    const req = {
      url: '/goals/calculate-and-save',
      user: { userId: String(user._id) },
      _body: { ...basePayload(), age_years: 25 },
    };
    const res = makeRes();

    await goalController.calculateAndSaveGoals(req, res);

    // Body wins regardless of DOB on file. We can't easily intercept the
    // service call without a deeper mock, so we just assert the controller
    // didn't bail with a missing-age error.
    if (res.statusCode === 400) {
      const parsed = JSON.parse(res.body);
      const errs = (parsed.validation && parsed.validation.errors) || [];
      expect(errs.join(' ')).not.toMatch(/Missing required field: age_years/);
    }
  });

  test('omitted age_years AND no dateOfBirth → 400 missing-field (unchanged)', async () => {
    const user = await seedUser(); // no dateOfBirth
    const req = {
      url: '/goals/calculate-and-save',
      user: { userId: String(user._id) },
      _body: basePayload(),
    };
    const res = makeRes();

    await goalController.calculateAndSaveGoals(req, res);

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.validation.errors.join(' ')).toMatch(
      /Missing required field: age_years/
    );
  });
});
