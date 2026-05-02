// CAL-36: getActiveQuestions('PLAN_CREATION', userId) drops the DOB
// question when the caller already has User.dateOfBirth set, so Goal
// Settings re-entry from Profile doesn't re-ask. Anonymous callers
// (initial onboarding, no JWT) always see the DOB question.

const mongoose = require('mongoose');
const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');

const User = require('../models/schemas/User');
const Question = require('../models/schemas/Question');
const OnboardingService = require('../services/onboardingService');

const DOB_QUESTION_ID = '6908fe66896ccf24778c907a';

let logSpy, errSpy;

beforeAll(async () => {
  await setupMongoServer();
  await User.init();
  await Question.init();
});

afterAll(async () => {
  await teardownMongoServer();
});

beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  await clearAllCollections();
});

// Seed only what's needed to make the PLAN_CREATION query return a
// non-empty list with the DOB question present. The filter logic only
// cares about whether DOB_QUESTION_ID is in the response, not about the
// rest of the chain — but seeding two rows (DOB + one other) makes the
// "filter dropped DOB but kept others" assertion meaningful.
async function seedDobQuestion() {
  return Question.create({
    _id: new mongoose.Types.ObjectId(DOB_QUESTION_ID),
    text: "What's your date of birth?",
    type: 'DATE',
    sequence: 9,
    isActive: true,
  });
}

async function seedGenderQuestion() {
  return Question.create({
    _id: new mongoose.Types.ObjectId('6908fe66896ccf24778c9075'),
    text: 'Choose your gender',
    type: 'SELECT',
    sequence: 1,
    isActive: true,
  });
}

describe("getActiveQuestions('PLAN_CREATION', userId) — DOB filter", () => {
  test('anonymous caller (userId=null) sees DOB question', async () => {
    await seedDobQuestion();
    await seedGenderQuestion();

    const questions = await OnboardingService.getActiveQuestions('PLAN_CREATION', null);
    const ids = questions.map((q) => String(q._id));
    expect(ids).toContain(DOB_QUESTION_ID);
  });

  test('authenticated user without dateOfBirth sees DOB question', async () => {
    await seedDobQuestion();
    await seedGenderQuestion();
    const user = await User.create({ phone: '+15551234567' });

    const questions = await OnboardingService.getActiveQuestions('PLAN_CREATION', user._id);
    const ids = questions.map((q) => String(q._id));
    expect(ids).toContain(DOB_QUESTION_ID);
  });

  test('authenticated user with dateOfBirth set does NOT see DOB question', async () => {
    await seedDobQuestion();
    await seedGenderQuestion();
    const user = await User.create({
      phone: '+15551234567',
      dateOfBirth: new Date('1990-05-15'),
    });

    const questions = await OnboardingService.getActiveQuestions('PLAN_CREATION', user._id);
    const ids = questions.map((q) => String(q._id));
    expect(ids).not.toContain(DOB_QUESTION_ID);
    // Non-DOB questions are still returned.
    expect(ids).toContain('6908fe66896ccf24778c9075');
  });

  test('userId pointing to non-existent user is treated as anonymous (DOB present)', async () => {
    await seedDobQuestion();
    const ghostId = new mongoose.Types.ObjectId();

    const questions = await OnboardingService.getActiveQuestions('PLAN_CREATION', ghostId);
    const ids = questions.map((q) => String(q._id));
    expect(ids).toContain(DOB_QUESTION_ID);
  });
});
