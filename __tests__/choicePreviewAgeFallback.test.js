// CAL-36 follow-up: same DOB-derivation as calculateAndSaveGoals (PR #54),
// but for POST /goals/choice-preview. Goal Settings re-entry no longer asks
// DOB and stops sending age_years from this surface; choice-preview must
// fall back to User.dateOfBirth via the optional req.user attached by the
// updated middleware. Anonymous initial onboarding (no token) still works
// when age_years is in the body.

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
  return {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

async function seedUser(extra = {}) {
  return User.create({ phone: '+15557654321', name: 'Preview Test', ...extra });
}

// Same field set choicePreview validates (sex, height, weight, goal_type,
// pace) minus age_years.
function basePreviewPayload() {
  return {
    sex_at_birth: 'male',
    height_cm: 175,
    weight_kg: 75,
    goal_type: 'maintain',
    pace_kg_per_week: 0,
  };
}

describe('choicePreview — age_years fallback (CAL-36 follow-up)', () => {
  test('Goal Settings re-entry: omitted age_years derived from User.dateOfBirth', async () => {
    const user = await seedUser({ dateOfBirth: new Date('1990-05-15') });
    const req = {
      url: '/goals/choice-preview',
      user: { userId: String(user._id) },
      _body: basePreviewPayload(),
    };
    const res = makeRes();

    await goalController.choicePreview(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(parsed.data).toBeDefined();
  });

  test('Initial onboarding: anonymous request with age_years in body still works', async () => {
    const req = {
      url: '/goals/choice-preview',
      // No req.user — anonymous (pre-signup onboarding).
      _body: { ...basePreviewPayload(), age_years: 28 },
    };
    const res = makeRes();

    await goalController.choicePreview(req, res);

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
  });

  test('body-supplied age_years wins over User.dateOfBirth', async () => {
    const user = await seedUser({ dateOfBirth: new Date('1990-05-15') });
    const req = {
      url: '/goals/choice-preview',
      user: { userId: String(user._id) },
      _body: { ...basePreviewPayload(), age_years: 25 },
    };
    const res = makeRes();

    await goalController.choicePreview(req, res);

    expect(res.statusCode).toBe(200);
  });

  test('omitted age_years, authed user without dateOfBirth → 400 missing-field', async () => {
    const user = await seedUser(); // no dateOfBirth on file
    const req = {
      url: '/goals/choice-preview',
      user: { userId: String(user._id) },
      _body: basePreviewPayload(),
    };
    const res = makeRes();

    await goalController.choicePreview(req, res);

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.validation.errors.join(' ')).toMatch(
      /Missing required field: age_years/
    );
  });

  test('omitted age_years, anonymous (no req.user) → 400 missing-field', async () => {
    const req = {
      url: '/goals/choice-preview',
      // No req.user — fallback path is unreachable, validator surfaces 400.
      _body: basePreviewPayload(),
    };
    const res = makeRes();

    await goalController.choicePreview(req, res);

    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.validation.errors.join(' ')).toMatch(
      /Missing required field: age_years/
    );
  });
});
