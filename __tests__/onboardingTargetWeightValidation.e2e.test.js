// CAL-33 — integration test for OnboardingService.saveUserAnswers's
// cross-field target-weight validation. Spins up an in-memory Mongo,
// seeds the target-weight question with the validation payload from
// the migration, and exercises the resolution + validation path.

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
});
