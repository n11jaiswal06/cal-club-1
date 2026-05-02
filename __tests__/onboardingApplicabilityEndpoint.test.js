// CAL-32 — DB-level integration tests for POST /onboarding/questions/applicability.
// Seeds real Question documents into mongo-memory-server, then drives the
// controller fn directly with a stream-like req mock (mirroring how parseBody
// reads the request body in production).

const { Readable } = require('stream');
const mongoose = require('mongoose');

const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');

const Question = require('../models/schemas/Question');
const OnboardingController = require('../controllers/onboardingController');

let errSpy;

beforeAll(async () => {
  await setupMongoServer();
  await Question.init();
});

afterAll(async () => {
  await teardownMongoServer();
});

beforeEach(() => {
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  errSpy.mockRestore();
  await clearAllCollections();
});

// --- helpers ---------------------------------------------------------------

function mockResponse() {
  const res = {
    statusCode: null,
    headers: null,
    body: null,
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(payload) {
      this.body = payload;
      if (typeof this._resolve === 'function') this._resolve();
    },
  };
  res.done = new Promise((resolve) => {
    res._resolve = resolve;
  });
  return res;
}

function mockRequest(body) {
  const req = Readable.from([JSON.stringify(body)]);
  return req;
}

async function callApplicability(body) {
  const req = mockRequest(body);
  const res = mockResponse();
  OnboardingController.getQuestionsApplicability(req, res);
  await res.done;
  return {
    statusCode: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
  };
}

// --- fixtures --------------------------------------------------------------

async function seedGoalChain() {
  const goal = await Question.create({
    text: "What's your primary goal?",
    type: 'SELECT',
    sequence: 10,
    slug: 'goal_type',
    options: [
      { text: 'Lose fat', value: 'lose' },
      { text: 'Gain muscle', value: 'gain' },
      { text: 'Build muscle while losing weight', value: 'recomp' },
      { text: 'Maintain', value: 'maintain' },
    ],
  });

  const targetWeight = await Question.create({
    text: "What's your target weight?",
    type: 'PICKER',
    sequence: 11,
    slug: 'target_weight',
    skipIf: [
      { questionId: goal._id, valueIn: ['maintain', 'recomp'] },
    ],
  });

  const rateLoss = await Question.create({
    text: 'How fast do you want to lose?',
    type: 'SELECT',
    sequence: 13.3,
    slug: 'rate_loss',
    skipIf: [
      { questionId: goal._id, valueIn: ['gain', 'recomp', 'maintain'] },
    ],
  });

  const rateGain = await Question.create({
    text: 'How fast do you want to gain?',
    type: 'SELECT',
    sequence: 13.5,
    slug: 'rate_gain',
    skipIf: [
      { questionId: goal._id, valueIn: ['lose', 'recomp', 'maintain'] },
    ],
  });

  const recompInfo = await Question.create({
    text: 'About body recomposition…',
    type: 'INFO_SCREEN',
    sequence: 13.7,
    slug: 'recomp_expectation',
    skipIf: [
      { questionId: goal._id, valueIn: ['lose', 'gain', 'maintain'] },
    ],
  });

  return { goal, targetWeight, rateLoss, rateGain, recompInfo };
}

// --- tests -----------------------------------------------------------------

describe('POST /onboarding/questions/applicability — happy path', () => {
  test('goal=maintain hides target_weight, rate_loss, rate_gain, recomp_expectation', async () => {
    const { goal } = await seedGoalChain();

    const { statusCode, body } = await callApplicability({
      answers: [{ questionId: goal._id.toString(), values: ['maintain'] }],
    });

    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
    expect(body.count).toBe(body.data.length);

    const bySlug = Object.fromEntries(body.data.map((q) => [q.slug, q.applicable]));
    expect(bySlug.goal_type).toBe(true);
    expect(bySlug.target_weight).toBe(false);
    expect(bySlug.rate_loss).toBe(false);
    expect(bySlug.rate_gain).toBe(false);
    expect(bySlug.recomp_expectation).toBe(false);
  });

  test('goal=recomp shows recomp_expectation, hides target_weight + rate_loss + rate_gain', async () => {
    const { goal } = await seedGoalChain();

    const { statusCode, body } = await callApplicability({
      answers: [{ questionId: goal._id.toString(), values: ['recomp'] }],
    });

    expect(statusCode).toBe(200);
    const bySlug = Object.fromEntries(body.data.map((q) => [q.slug, q.applicable]));
    expect(bySlug.target_weight).toBe(false);
    expect(bySlug.rate_loss).toBe(false);
    expect(bySlug.rate_gain).toBe(false);
    expect(bySlug.recomp_expectation).toBe(true);
  });

  test('empty answers array → all questions applicable', async () => {
    await seedGoalChain();

    const { statusCode, body } = await callApplicability({ answers: [] });

    expect(statusCode).toBe(200);
    expect(body.data.every((q) => q.applicable === true)).toBe(true);
  });

  test('response preserves the existing question projection (slug, skipIf, sequence)', async () => {
    const { goal } = await seedGoalChain();

    const { body } = await callApplicability({
      answers: [{ questionId: goal._id.toString(), values: ['lose'] }],
    });

    const target = body.data.find((q) => q.slug === 'target_weight');
    expect(target).toBeDefined();
    expect(target).toHaveProperty('_id');
    expect(target).toHaveProperty('sequence', 11);
    expect(Array.isArray(target.skipIf)).toBe(true);
    expect(target.skipIf[0].valueIn).toEqual(['maintain', 'recomp']);
    expect(target.applicable).toBe(true);
  });
});

describe('POST /onboarding/questions/applicability — validation', () => {
  test('400 when answers is missing', async () => {
    const { statusCode, body } = await callApplicability({});
    expect(statusCode).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/answers must be an array/i);
  });

  test('400 when answers is not an array', async () => {
    const { statusCode, body } = await callApplicability({ answers: 'nope' });
    expect(statusCode).toBe(400);
    expect(body.message).toMatch(/answers must be an array/i);
  });

  test('400 when an entry has invalid questionId hex', async () => {
    const { statusCode, body } = await callApplicability({
      answers: [{ questionId: 'not-a-real-oid', values: ['lose'] }],
    });
    expect(statusCode).toBe(400);
    expect(body.message).toMatch(/questionId/);
  });

  test('400 when an entry is missing values array', async () => {
    const valid = new mongoose.Types.ObjectId().toString();
    const { statusCode, body } = await callApplicability({
      answers: [{ questionId: valid }],
    });
    expect(statusCode).toBe(400);
    expect(body.message).toMatch(/values/);
  });

  test('400 when type is unknown', async () => {
    const { statusCode, body } = await callApplicability({
      type: 'NOT_A_TYPE',
      answers: [],
    });
    expect(statusCode).toBe(400);
    expect(body.message).toMatch(/Invalid type/i);
  });

  test('accepts type omitted', async () => {
    await seedGoalChain();
    const { statusCode, body } = await callApplicability({ answers: [] });
    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
  });

  test('accepts type=null explicitly', async () => {
    await seedGoalChain();
    const { statusCode, body } = await callApplicability({ type: null, answers: [] });
    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
  });

  test('accepts empty-string type as omitted', async () => {
    await seedGoalChain();
    const { statusCode, body } = await callApplicability({ type: '', answers: [] });
    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
  });
});
