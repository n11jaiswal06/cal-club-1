// CAL-33 — integration test for OnboardingService.saveUserAnswers's
// cross-field target-weight validation. Spins up an in-memory Mongo,
// seeds the target-weight question with the validation payload from
// the migration, and exercises the resolution + validation path.

const { Readable } = require('stream');
const mongoose = require('mongoose');
const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');

const Question = require('../models/schemas/Question');
const UserQuestion = require('../models/schemas/UserQuestion');
const UserLog = require('../models/schemas/UserLog');
const OnboardingService = require('../services/onboardingService');
const OnboardingController = require('../controllers/onboardingController');
const { OnboardingValidationError } = require('../services/onboardingService');
const { TARGET_WEIGHT_VALIDATION } = require('../scripts/migrate_onboarding_cal33');
const { CODE } = require('../services/targetWeightValidator');

const TARGET_WEIGHT_QID = '6908fe66896ccf24778c907f';
const HEIGHT_WEIGHT_QID = '6908fe66896ccf24778c9079';
const GOAL_TYPE_QID = '6908fe66896ccf24778c907d';

beforeAll(async () => {
  await setupMongoServer();
  await Question.init();
});

afterAll(teardownMongoServer);

afterEach(async () => {
  await clearAllCollections();
});

async function seedQuestions() {
  await Question.create([
    {
      _id: new mongoose.Types.ObjectId(TARGET_WEIGHT_QID),
      slug: 'target_weight',
      text: "What's your target weight (kg)?",
      type: 'PICKER',
      sequence: 11,
      isActive: true,
      validation: TARGET_WEIGHT_VALIDATION,
    },
    {
      _id: new mongoose.Types.ObjectId(HEIGHT_WEIGHT_QID),
      slug: 'height_weight',
      text: "What's your height and weight?",
      type: 'PICKER',
      sequence: 9,
      isActive: true,
    },
    {
      _id: new mongoose.Types.ObjectId(GOAL_TYPE_QID),
      slug: 'goal_type',
      text: "What's your primary goal?",
      type: 'SELECT',
      sequence: 10,
      isActive: true,
      options: [
        { text: 'Lose fat', value: 'lose' },
        { text: 'Gain muscle', value: 'gain' },
      ],
    },
  ]);
}

function answer(qid, values, userId) {
  return { userId, questionId: qid, values };
}

describe('saveUserAnswers — CAL-33 cross-field validation', () => {
  test('lose + target below current passes and persists', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();

    await OnboardingService.saveUserAnswers([
      answer(GOAL_TYPE_QID, ['lose'], userId),
      answer(HEIGHT_WEIGHT_QID, ['height_170&weight_75'], userId),
      answer(TARGET_WEIGHT_QID, ['weight_68'], userId),
    ]);

    const stored = await UserQuestion.find({ userId, deletedAt: null }).lean();
    expect(stored).toHaveLength(3);
  });

  test('lose + target above current → 422-shaped OnboardingValidationError, no rows written', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();

    await expect(OnboardingService.saveUserAnswers([
      answer(GOAL_TYPE_QID, ['lose'], userId),
      answer(HEIGHT_WEIGHT_QID, ['height_170&weight_75'], userId),
      answer(TARGET_WEIGHT_QID, ['weight_80'], userId),
    ])).rejects.toBeInstanceOf(OnboardingValidationError);

    const stored = await UserQuestion.find({ userId }).lean();
    expect(stored).toHaveLength(0);
  });

  test('gain + target below current → INVALID_FOR_GOAL', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();

    let caught;
    try {
      await OnboardingService.saveUserAnswers([
        answer(GOAL_TYPE_QID, ['gain'], userId),
        answer(HEIGHT_WEIGHT_QID, ['height_170&weight_70'], userId),
        answer(TARGET_WEIGHT_QID, ['weight_65'], userId),
      ]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OnboardingValidationError);
    expect(caught.errors.map(e => e.code)).toContain(CODE.INVALID_FOR_GOAL);
    expect(caught.errors[0].field).toBe('desired_weight_kg');
    expect(caught.errors[0].message).toMatch(/gain muscle/i);
  });

  test('recomp goal + target submitted → INVALID_FOR_NON_DIRECTIONAL_GOAL', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();

    let caught;
    try {
      await OnboardingService.saveUserAnswers([
        answer(GOAL_TYPE_QID, ['recomp'], userId),
        answer(HEIGHT_WEIGHT_QID, ['height_170&weight_70'], userId),
        answer(TARGET_WEIGHT_QID, ['weight_65'], userId),
      ]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OnboardingValidationError);
    expect(caught.errors.map(e => e.code)).toContain(CODE.INVALID_FOR_NON_DIRECTIONAL_GOAL);
  });

  test('falls back to prior UserQuestion answers when goal/weight not in same payload', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();

    // Simulate question-by-question submission: goal + weight stored
    // earlier, target submitted alone in a later request.
    await UserQuestion.create([
      { userId, questionId: new mongoose.Types.ObjectId(GOAL_TYPE_QID), values: ['lose'] },
      { userId, questionId: new mongoose.Types.ObjectId(HEIGHT_WEIGHT_QID), values: ['height_170&weight_75'] },
    ]);

    await expect(OnboardingService.saveUserAnswers([
      answer(TARGET_WEIGHT_QID, ['weight_80'], userId),
    ])).rejects.toBeInstanceOf(OnboardingValidationError);
  });

  test('falls back to UserLog WEIGHT entry when no prior height/weight answer', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();
    await UserLog.create({
      userId,
      type: 'WEIGHT',
      value: '75',
      unit: 'kg',
      date: '2026-04-15',
    });

    await expect(OnboardingService.saveUserAnswers([
      answer(GOAL_TYPE_QID, ['lose'], userId),
      answer(TARGET_WEIGHT_QID, ['weight_80'], userId),
    ])).rejects.toBeInstanceOf(OnboardingValidationError);
  });

  test('no validation payload on the question → no-op (accept)', async () => {
    await Question.create({
      _id: new mongoose.Types.ObjectId(TARGET_WEIGHT_QID),
      slug: 'target_weight',
      text: "What's your target weight (kg)?",
      type: 'PICKER',
      sequence: 11,
      isActive: true,
      // no validation field
    });
    const userId = new mongoose.Types.ObjectId();

    await OnboardingService.saveUserAnswers([
      answer(TARGET_WEIGHT_QID, ['weight_999'], userId),
    ]);

    const stored = await UserQuestion.find({ userId, deletedAt: null }).lean();
    expect(stored).toHaveLength(1);
  });

  test('payload without target-weight question → validation is a no-op', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();

    await OnboardingService.saveUserAnswers([
      answer(GOAL_TYPE_QID, ['lose'], userId),
    ]);

    const stored = await UserQuestion.find({ userId, deletedAt: null }).lean();
    expect(stored).toHaveLength(1);
  });

  // CAL-33: defensive — on a fresh deploy the canonical hexes from the
  // CAL-9 seed weren't minted, so the target-weight question's `_id` is
  // some other ObjectId. The FE pins by slug (CAL-30) and submits with
  // the real `_id`. Validator must still gate.
  test('slug-resolved id (different from pinned hex) is matched correctly', async () => {
    // Seed all three canonical questions with FRESHLY-MINTED ObjectIds —
    // none of them are the pinned hexes.
    const goalId = new mongoose.Types.ObjectId();
    const heightId = new mongoose.Types.ObjectId();
    const targetId = new mongoose.Types.ObjectId();
    await Question.create([
      {
        _id: targetId,
        slug: 'target_weight',
        text: "What's your target weight (kg)?",
        type: 'PICKER',
        sequence: 11,
        isActive: true,
        validation: TARGET_WEIGHT_VALIDATION,
      },
      {
        _id: heightId,
        slug: 'height_weight',
        text: "What's your height and weight?",
        type: 'PICKER',
        sequence: 9,
        isActive: true,
      },
      {
        _id: goalId,
        slug: 'goal_type',
        text: "What's your primary goal?",
        type: 'SELECT',
        sequence: 10,
        isActive: true,
        options: [{ text: 'Lose fat', value: 'lose' }],
      },
    ]);
    const userId = new mongoose.Types.ObjectId();

    await expect(OnboardingService.saveUserAnswers([
      answer(goalId.toString(), ['lose'], userId),
      answer(heightId.toString(), ['height_170&weight_75'], userId),
      answer(targetId.toString(), ['weight_80'], userId),
    ])).rejects.toBeInstanceOf(OnboardingValidationError);
  });

  // Finding 3: weight_0 is no longer a silent skip — INVALID_NUMBER fires.
  test('weight_0 in the target-weight payload → INVALID_NUMBER', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();

    let caught;
    try {
      await OnboardingService.saveUserAnswers([
        answer(GOAL_TYPE_QID, ['lose'], userId),
        answer(HEIGHT_WEIGHT_QID, ['height_170&weight_75'], userId),
        answer(TARGET_WEIGHT_QID, ['weight_0'], userId),
      ]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OnboardingValidationError);
    expect(caught.errors.map(e => e.code)).toContain(CODE.INVALID_NUMBER);
    const stored = await UserQuestion.find({ userId, deletedAt: null }).lean();
    expect(stored).toHaveLength(0);
  });

  // Truly malformed payload (regex doesn't match) still no-ops the
  // validator — same as pre-PR behavior — so we don't break free-form
  // PICKER values that haven't been seeded yet.
  test('malformed target-weight string (no weight_N pattern) is a no-op', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();

    await OnboardingService.saveUserAnswers([
      answer(GOAL_TYPE_QID, ['lose'], userId),
      answer(HEIGHT_WEIGHT_QID, ['height_170&weight_75'], userId),
      answer(TARGET_WEIGHT_QID, ['some-other-format'], userId),
    ]);
    const stored = await UserQuestion.find({ userId, deletedAt: null }).lean();
    expect(stored).toHaveLength(3);
  });
});

// --- HTTP / controller wire-format tests -----------------------------------
//
// Finding 2: cover the controller's mapping of OnboardingValidationError
// → HTTP 422 with the documented response shape so a future regression
// (e.g. the catch order changing, error-class import drifting) trips a
// test instead of leaking a 500 to the client.

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
  res.done = new Promise((resolve) => { res._resolve = resolve; });
  return res;
}

function mockRequest(body, userId) {
  const req = Readable.from([JSON.stringify(body)]);
  req.user = { userId: String(userId) };
  req.headers = { host: 'localhost' };
  req.url = '/onboarding/answers';
  return req;
}

async function callSaveAnswers(body, userId) {
  const req = mockRequest(body, userId);
  const res = mockResponse();
  OnboardingController.saveAnswers(req, res);
  await res.done;
  return {
    statusCode: res.statusCode,
    body: res.body ? JSON.parse(res.body) : null,
  };
}

describe('POST /onboarding/answers — CAL-33 422 wire format', () => {
  test('lose + target above current → 422 with structured errors', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();
    const { statusCode, body } = await callSaveAnswers({
      answers: [
        { questionId: GOAL_TYPE_QID, values: ['lose'] },
        { questionId: HEIGHT_WEIGHT_QID, values: ['height_170&weight_75'] },
        { questionId: TARGET_WEIGHT_QID, values: ['weight_80'] },
      ],
    }, userId);
    expect(statusCode).toBe(422);
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/validation/i);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.errors[0]).toMatchObject({
      field: 'desired_weight_kg',
      code: CODE.INVALID_FOR_GOAL,
    });
    expect(typeof body.errors[0].message).toBe('string');
    const stored = await UserQuestion.find({ userId }).lean();
    expect(stored).toHaveLength(0);
  });

  test('valid payload → 200 with success body', async () => {
    await seedQuestions();
    const userId = new mongoose.Types.ObjectId();
    const { statusCode, body } = await callSaveAnswers({
      answers: [
        { questionId: GOAL_TYPE_QID, values: ['lose'] },
        { questionId: HEIGHT_WEIGHT_QID, values: ['height_170&weight_75'] },
        { questionId: TARGET_WEIGHT_QID, values: ['weight_68'] },
      ],
    }, userId);
    expect(statusCode).toBe(200);
    expect(body.success).toBe(true);
  });
});
