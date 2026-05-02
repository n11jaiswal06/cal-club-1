// CAL-36: DOB capture during onboarding writes the parsed date to
// User.dateOfBirth so the Goal Settings sub-flow can suppress the DOB
// ask on Profile re-entry. Tests both the helper directly and the
// saveUserAnswers side-effect block. End-to-end against in-memory Mongo
// because the helper does a real findByIdAndUpdate.

const mongoose = require('mongoose');
const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');

const User = require('../models/schemas/User');
const Question = require('../models/schemas/Question');
const OnboardingService = require('../services/onboardingService');
const { DOB_QUESTION_ID } = require('../services/onboardingService');

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

async function seedUser() {
  return User.create({ phone: '+15551234567', name: 'Test User' });
}

describe('updateUserDateOfBirth', () => {
  test('happy path: ISO date string is parsed and persisted', async () => {
    const user = await seedUser();
    await OnboardingService.updateUserDateOfBirth(user._id, '1990-05-15');

    const refreshed = await User.findById(user._id).lean();
    expect(refreshed.dateOfBirth).toBeInstanceOf(Date);
    expect(refreshed.dateOfBirth.toISOString().slice(0, 10)).toBe('1990-05-15');
  });

  test('accepts string user id (controller passes JWT userId as string)', async () => {
    const user = await seedUser();
    await OnboardingService.updateUserDateOfBirth(String(user._id), '1985-01-01');

    const refreshed = await User.findById(user._id).lean();
    expect(refreshed.dateOfBirth.toISOString().slice(0, 10)).toBe('1985-01-01');
  });

  test('rejects unparseable string and leaves dateOfBirth unset', async () => {
    const user = await seedUser();
    await OnboardingService.updateUserDateOfBirth(user._id, 'not-a-date');

    const refreshed = await User.findById(user._id).lean();
    expect(refreshed.dateOfBirth == null).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/unparseable or out-of-range/i)
    );
  });

  test('rejects out-of-range year (pre-1900)', async () => {
    const user = await seedUser();
    await OnboardingService.updateUserDateOfBirth(user._id, '1850-06-01');

    const refreshed = await User.findById(user._id).lean();
    expect(refreshed.dateOfBirth == null).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/unparseable or out-of-range/i)
    );
  });

  test('rejects out-of-range year (future)', async () => {
    const user = await seedUser();
    const futureYear = new Date().getUTCFullYear() + 1;
    await OnboardingService.updateUserDateOfBirth(user._id, `${futureYear}-01-01`);

    const refreshed = await User.findById(user._id).lean();
    expect(refreshed.dateOfBirth == null).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/unparseable or out-of-range/i)
    );
  });

  test('warns and no-ops when user does not exist', async () => {
    const ghostId = new mongoose.Types.ObjectId();
    await OnboardingService.updateUserDateOfBirth(ghostId, '1990-01-01');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/User not found/i)
    );
  });
});

describe('saveUserAnswers — DOB side-effect', () => {
  test('DOB answer triggers updateUserDateOfBirth in background', async () => {
    const user = await seedUser();
    // Seed a Question so the DOB row hits a real ObjectId reference. The
    // saveUserAnswers path doesn't validate questionId existence; we only
    // need the row so the background update has something to find.

    const spy = jest
      .spyOn(OnboardingService, 'updateUserDateOfBirth')
      .mockResolvedValue();

    await OnboardingService.saveUserAnswers([
      {
        userId: user._id,
        questionId: DOB_QUESTION_ID,
        values: ['1990-05-15'],
      },
    ]);

    // Background fire-and-forget — give the microtask queue a tick.
    await new Promise((r) => setImmediate(r));

    expect(spy).toHaveBeenCalledWith(user._id, '1990-05-15');
    spy.mockRestore();
  });

  test('non-DOB answer does NOT trigger updateUserDateOfBirth', async () => {
    const user = await seedUser();
    const spy = jest
      .spyOn(OnboardingService, 'updateUserDateOfBirth')
      .mockResolvedValue();

    await OnboardingService.saveUserAnswers([
      {
        userId: user._id,
        // Some other question id (gender)
        questionId: '6908fe66896ccf24778c9075',
        values: ['Male'],
      },
    ]);

    await new Promise((r) => setImmediate(r));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('empty DOB values array does NOT trigger update', async () => {
    const user = await seedUser();
    const spy = jest
      .spyOn(OnboardingService, 'updateUserDateOfBirth')
      .mockResolvedValue();

    await OnboardingService.saveUserAnswers([
      { userId: user._id, questionId: DOB_QUESTION_ID, values: [''] },
    ]);

    await new Promise((r) => setImmediate(r));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
