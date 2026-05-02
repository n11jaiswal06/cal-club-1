// CAL-33 migration — end-to-end against in-memory Mongo. Asserts the
// validation payload lands on the target-weight question regardless of
// which lookup rung resolved it (slug / pinned _id / text fingerprint),
// and that re-running is idempotent.

const mongoose = require('mongoose');
const {
  setupMongoServer,
  teardownMongoServer,
  clearAllCollections,
} = require('./helpers/mongoMemoryServer');

const Question = require('../models/schemas/Question');
const {
  TARGET_WEIGHT_PINNED_ID,
  TARGET_WEIGHT_VALIDATION,
  migrate,
} = require('../scripts/migrate_onboarding_cal33');

let logSpy, errSpy;

beforeAll(async () => {
  await setupMongoServer();
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

function seedTargetWeight(overrides = {}) {
  return Question.create({
    text: "What's your target weight (kg)?",
    type: 'PICKER',
    sequence: 11,
    isActive: true,
    ...overrides,
  });
}

describe('CAL-33 migrate — apply paths', () => {
  test('locates by slug=target_weight, sets validation payload', async () => {
    await seedTargetWeight({ slug: 'target_weight' });
    await migrate({ apply: true });
    const after = await Question.findOne({ slug: 'target_weight' }).lean();
    expect(after.validation).toBeDefined();
    expect(after.validation.minValue).toBe(TARGET_WEIGHT_VALIDATION.minValue);
    expect(after.validation.maxValue).toBe(TARGET_WEIGHT_VALIDATION.maxValue);
    expect(after.validation.requireGoalDirection.goalQuestionSlug).toBe('goal_type');
    expect(after.validation.requireGoalDirection.minDeltaKg).toBe(0.5);
    expect(after.validation.copy.invalidForLose).toMatch(/lose fat/i);
  });

  test('locates by pinned _id when slug is absent', async () => {
    await seedTargetWeight({ _id: new mongoose.Types.ObjectId(TARGET_WEIGHT_PINNED_ID) });
    await migrate({ apply: true });
    const after = await Question.findById(TARGET_WEIGHT_PINNED_ID).lean();
    expect(after.validation.minValue).toBe(30);
  });

  test('locates by text fingerprint when slug and pinned id absent', async () => {
    await seedTargetWeight();
    await migrate({ apply: true });
    const after = await Question.findOne({ text: /target weight/i }).lean();
    expect(after.validation).toBeDefined();
    expect(after.validation.maxValue).toBe(250);
  });

  test('idempotent: re-applying does not modify the document', async () => {
    await seedTargetWeight({ slug: 'target_weight' });
    await migrate({ apply: true });
    const beforeValidation = (await Question.findOne({ slug: 'target_weight' }).lean()).validation;
    // Re-run; assert the validation payload round-trips identically. Any
    // change in field shape, ordering, or numeric type would trip this.
    await migrate({ apply: true });
    const afterValidation = (await Question.findOne({ slug: 'target_weight' }).lean()).validation;
    expect(JSON.stringify(afterValidation)).toBe(JSON.stringify(beforeValidation));
    expect(afterValidation.minValue).toBe(TARGET_WEIGHT_VALIDATION.minValue);
    expect(afterValidation.maxValue).toBe(TARGET_WEIGHT_VALIDATION.maxValue);
  });
});

describe('CAL-33 migrate — failure paths', () => {
  test('throws when no candidate matches', async () => {
    await expect(migrate({ apply: true })).rejects.toThrow(/Target-weight question not found/);
  });

  test('text-fingerprint ambiguity → not-found path (refuses to guess)', async () => {
    await seedTargetWeight({ sequence: 11 });
    await seedTargetWeight({ sequence: 12, text: 'Pick your target weight goal' });
    await expect(migrate({ apply: true })).rejects.toThrow(/Target-weight question not found/);
  });
});

describe('CAL-33 migrate — dry-run', () => {
  test('does not modify the document', async () => {
    await seedTargetWeight({ slug: 'target_weight' });
    await migrate({ apply: false });
    const after = await Question.findOne({ slug: 'target_weight' }).lean();
    expect(after.validation).toBeUndefined();
  });
});
