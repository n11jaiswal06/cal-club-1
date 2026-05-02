// CAL-30 — tests for the cal18 migration's identity ladder:
//   findGoalQuestion() prefers slug → pinned _id → sequence+fingerprint
//   → fingerprint-only, and assertSlugBackfillRun() blocks re-applies on
//   a previously-migrated DB that hasn't yet been backfilled.
//
// Hermetic — stubs Question.findOne / .findById / .find. No Mongo
// connection required.

const Question = require('../models/schemas/Question');
const {
  GOAL_TYPE_PINNED_ID,
  findGoalQuestion,
  assertSlugBackfillRun,
} = require('../scripts/migrate_onboarding_cal18');

function goalShapedDoc(overrides = {}) {
  return {
    _id: 'oid-goal',
    sequence: 10,
    text: "What's your primary goal?",
    type: 'SELECT',
    options: [
      { text: 'Lose fat' },
      { text: 'Gain muscle' },
      { text: 'Build muscle while losing weight' },
      { text: 'Maintain' },
    ],
    ...overrides,
  };
}

describe('findGoalQuestion — CAL-30 lookup ladder', () => {
  let findOneSpy;
  let findByIdSpy;
  let findSpy;

  afterEach(() => {
    [findOneSpy, findByIdSpy, findSpy].forEach((s) => s && s.mockRestore());
    findOneSpy = findByIdSpy = findSpy = null;
  });

  test('(1) returns slug match when slug is set — does not consult pinned _id', async () => {
    const doc = goalShapedDoc({ slug: 'goal_type' });
    findOneSpy = jest.spyOn(Question, 'findOne').mockImplementation((filter) => {
      if (filter && filter.slug === 'goal_type') return Promise.resolve(doc);
      return Promise.resolve(null);
    });
    findByIdSpy = jest.spyOn(Question, 'findById').mockResolvedValue(null);

    const { q, foundBy } = await findGoalQuestion();

    expect(q).toBe(doc);
    expect(foundBy).toBe('slug=goal_type');
    expect(findByIdSpy).not.toHaveBeenCalled();
  });

  test('(2) falls back to pinned _id when slug is missing', async () => {
    const doc = goalShapedDoc();
    findOneSpy = jest.spyOn(Question, 'findOne').mockResolvedValue(null);
    findByIdSpy = jest
      .spyOn(Question, 'findById')
      .mockImplementation((id) =>
        id === GOAL_TYPE_PINNED_ID ? Promise.resolve(doc) : Promise.resolve(null)
      );

    const { q, foundBy } = await findGoalQuestion();

    expect(q).toBe(doc);
    expect(foundBy).toBe('pinned-id');
  });

  test('(3) falls back to sequence:10 with fingerprint guard', async () => {
    const doc = goalShapedDoc();
    findOneSpy = jest.spyOn(Question, 'findOne').mockImplementation((filter) => {
      if (filter && filter.slug) return Promise.resolve(null);
      if (filter && filter.sequence === 10) return Promise.resolve(doc);
      return Promise.resolve(null);
    });
    findByIdSpy = jest.spyOn(Question, 'findById').mockResolvedValue(null);

    const { q, foundBy } = await findGoalQuestion();

    expect(q).toBe(doc);
    expect(foundBy).toBe('sequence-10');
  });

  test('(3) rejects sequence:10 when the doc there is NOT goal-shaped, then falls through', async () => {
    const wrongDoc = {
      _id: 'oid-wrong',
      sequence: 10,
      text: 'How many workouts per week?',
      type: 'SELECT',
      options: [{ text: '1' }, { text: '2' }],
    };
    findOneSpy = jest.spyOn(Question, 'findOne').mockImplementation((filter) => {
      if (filter && filter.slug) return Promise.resolve(null);
      if (filter && filter.sequence === 10) return Promise.resolve(wrongDoc);
      return Promise.resolve(null);
    });
    findByIdSpy = jest.spyOn(Question, 'findById').mockResolvedValue(null);
    // (4) fingerprint-only with no candidates → not-found.
    findSpy = jest
      .spyOn(Question, 'find')
      .mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const { q, foundBy } = await findGoalQuestion();

    expect(q).toBeNull();
    expect(foundBy).toBe('not-found');
  });

  test('(4) content fingerprint with exactly one match resolves the goal question', async () => {
    const doc = goalShapedDoc({ sequence: 9 }); // sequence drift — not at 10
    findOneSpy = jest.spyOn(Question, 'findOne').mockResolvedValue(null);
    findByIdSpy = jest.spyOn(Question, 'findById').mockResolvedValue(null);
    findSpy = jest
      .spyOn(Question, 'find')
      .mockReturnValue({ lean: jest.fn().mockResolvedValue([doc]) });

    const { q, foundBy } = await findGoalQuestion();

    expect(q).toBe(doc);
    expect(foundBy).toBe('fingerprint');
  });

  test('(4) ambiguous fingerprint (>1 match) returns null with diagnostic', async () => {
    findOneSpy = jest.spyOn(Question, 'findOne').mockResolvedValue(null);
    findByIdSpy = jest.spyOn(Question, 'findById').mockResolvedValue(null);
    findSpy = jest.spyOn(Question, 'find').mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        goalShapedDoc({ _id: 'a' }),
        goalShapedDoc({ _id: 'b' }),
      ]),
    });

    const { q, foundBy } = await findGoalQuestion();

    expect(q).toBeNull();
    expect(foundBy).toMatch(/ambiguous-fingerprint/);
  });

  test('(5) all rungs fail → returns not-found (caller fails loud)', async () => {
    findOneSpy = jest.spyOn(Question, 'findOne').mockResolvedValue(null);
    findByIdSpy = jest.spyOn(Question, 'findById').mockResolvedValue(null);
    findSpy = jest
      .spyOn(Question, 'find')
      .mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    const { q, foundBy } = await findGoalQuestion();

    expect(q).toBeNull();
    expect(foundBy).toBe('not-found');
  });
});

describe('assertSlugBackfillRun — CAL-30 pre-flight guard', () => {
  let findOneSpy;

  afterEach(() => {
    if (findOneSpy) findOneSpy.mockRestore();
    findOneSpy = null;
  });

  test('passes silently when every checked slug already resolves', async () => {
    findOneSpy = jest.spyOn(Question, 'findOne').mockImplementation((filter) => {
      if (filter && filter.slug) return Promise.resolve({ _id: 'x', slug: filter.slug });
      return Promise.resolve(null);
    });

    await expect(assertSlugBackfillRun()).resolves.toBeUndefined();
  });

  test('passes silently on a fresh DB where neither slug nor sequence row exists', async () => {
    findOneSpy = jest.spyOn(Question, 'findOne').mockResolvedValue(null);

    await expect(assertSlugBackfillRun()).resolves.toBeUndefined();
  });

  test('aborts when sequence row exists but slug row does not (legacy migrated DB)', async () => {
    findOneSpy = jest.spyOn(Question, 'findOne').mockImplementation((filter) => {
      if (filter && filter.slug) return Promise.resolve(null);
      if (filter && typeof filter.sequence === 'number') {
        return Promise.resolve({
          _id: 'legacy',
          sequence: filter.sequence,
          text: `legacy seq=${filter.sequence}`,
        });
      }
      return Promise.resolve(null);
    });

    await expect(assertSlugBackfillRun()).rejects.toThrow(
      /Slug backfill required/
    );
  });
});
