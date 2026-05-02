// CAL-30 backfill — hermetic tests for slug fingerprints and the
// resolution rules in planBackfill(). Stubs Question.find so no Mongo
// connection is required.

const Question = require('../models/schemas/Question');
const {
  SLUG_DEFINITIONS,
  planBackfill,
  looksLikeGoalQuestion,
} = require('../scripts/backfill_question_slugs');

function makeFindStub(rows) {
  return {
    lean: jest.fn().mockResolvedValue(rows),
  };
}

function defBySlug(slug) {
  return SLUG_DEFINITIONS.find((d) => d.slug === slug);
}

describe('SLUG_DEFINITIONS — fingerprint behaviour', () => {
  test('exposes the 8 slugs in the CAL-30 expanded scope', () => {
    const slugs = SLUG_DEFINITIONS.map((d) => d.slug).sort();
    expect(slugs).toEqual(
      [
        'goal_type',
        'height_weight',
        'notification_permission',
        'rate_gain',
        'rate_loss',
        'recomp_expectation',
        'target_weight',
        'typical_activity',
      ].sort()
    );
  });

  test('every fingerprint is a function and tolerates malformed docs', () => {
    for (const def of SLUG_DEFINITIONS) {
      expect(typeof def.fingerprint).toBe('function');
      expect(() => def.fingerprint(null)).not.toThrow();
      expect(() => def.fingerprint({})).not.toThrow();
      expect(def.fingerprint(null)).toBe(false);
      expect(def.fingerprint({})).toBe(false);
    }
  });

  describe('goal_type', () => {
    const fp = defBySlug('goal_type').fingerprint;
    test('matches a SELECT with the canonical 4-option goal set', () => {
      expect(
        fp({
          type: 'SELECT',
          options: [
            { text: 'Gain muscle' },
            { text: 'Lose fat' },
            { text: 'Build muscle while losing weight' },
            { text: 'Maintain' },
          ],
        })
      ).toBe(true);
    });

    test('matches the legacy lowercase `select` casing', () => {
      expect(
        fp({
          type: 'select',
          options: [{ text: 'Lose weight' }, { text: 'Gain weight' }],
        })
      ).toBe(true);
    });

    test('rejects non-SELECT shapes even with goal-shaped options', () => {
      expect(
        fp({ type: 'INFO_SCREEN', options: [{ text: 'lose' }, { text: 'gain' }] })
      ).toBe(false);
    });

    test('rejects when fewer than 2 options match the goal regex', () => {
      expect(fp({ type: 'SELECT', options: [{ text: 'lose' }] })).toBe(false);
      expect(
        fp({ type: 'SELECT', options: [{ text: 'apple' }, { text: 'banana' }] })
      ).toBe(false);
    });
  });

  describe('rate_loss / rate_gain', () => {
    const loss = defBySlug('rate_loss').fingerprint;
    const gain = defBySlug('rate_gain').fingerprint;

    test('rate_loss accepts the post-CAL-18 shape (text + ratePercent metadata)', () => {
      expect(
        loss({
          type: 'SELECT',
          text: 'How fast do you want to lose weight?',
          options: [
            { text: 'Gentle', metadata: { ratePercent: 0.0025 } },
            { text: 'Steady', metadata: { ratePercent: 0.005 } },
            { text: 'Ambitious', metadata: { ratePercent: 0.01 } },
          ],
        })
      ).toBe(true);
    });

    test('rate_gain rejects a doc whose text mentions losing', () => {
      expect(
        gain({
          type: 'SELECT',
          text: 'How fast do you want to lose weight?',
          options: [{ text: 'Steady' }, { text: 'Aggressive' }],
        })
      ).toBe(false);
    });

    test('rate_loss rejects the deactivated SLIDER rate question', () => {
      expect(
        loss({
          type: 'SLIDER',
          text: 'How fast do you want to reach your goal?',
        })
      ).toBe(false);
    });
  });

  describe('recomp_expectation', () => {
    const fp = defBySlug('recomp_expectation').fingerprint;

    test('matches via infoScreen.heading even when text says nothing', () => {
      expect(
        fp({
          type: 'INFO_SCREEN',
          text: 'untitled',
          infoScreen: { heading: 'Recomp is the slow path' },
        })
      ).toBe(true);
    });

    test('rejects an INFO_SCREEN whose copy mentions only "lose"', () => {
      expect(
        fp({
          type: 'INFO_SCREEN',
          text: 'Lose fat fast',
          infoScreen: { heading: 'Lose fat fast' },
        })
      ).toBe(false);
    });
  });

  describe('notification_permission', () => {
    const fp = defBySlug('notification_permission').fingerprint;
    test('matches by the dedicated type — does not depend on copy', () => {
      expect(fp({ type: 'NOTIFICATION_PERMISSION', text: 'whatever' })).toBe(true);
      expect(fp({ type: 'SELECT', text: 'allow notifications?' })).toBe(false);
    });
  });

  test('looksLikeGoalQuestion is exported for reuse by cal18', () => {
    expect(typeof looksLikeGoalQuestion).toBe('function');
  });
});

describe('planBackfill — resolution rules', () => {
  let findSpy;

  function stubActiveQuestions(rows) {
    findSpy = jest.spyOn(Question, 'find').mockReturnValue(makeFindStub(rows));
  }

  afterEach(() => {
    if (findSpy) findSpy.mockRestore();
    findSpy = null;
  });

  function goalDoc(overrides = {}) {
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

  test('queues an update when one matching active doc has no slug', async () => {
    stubActiveQuestions([goalDoc()]);

    const ops = await planBackfill({ only: new Set(['goal_type']) });

    expect(ops).toHaveLength(1);
    expect(ops[0]).toEqual({
      slug: 'goal_type',
      filter: { _id: 'oid-goal' },
      update: { $set: { slug: 'goal_type' } },
    });
  });

  test('idempotent — slug already correct produces zero ops', async () => {
    stubActiveQuestions([goalDoc({ slug: 'goal_type' })]);

    const ops = await planBackfill({ only: new Set(['goal_type']) });

    expect(ops).toHaveLength(0);
  });

  test('CONFLICT — refuses to overwrite an existing different slug', async () => {
    stubActiveQuestions([goalDoc({ slug: 'something_else' })]);

    await expect(
      planBackfill({ only: new Set(['goal_type']) })
    ).rejects.toThrow(/AMBIGUOUS or CONFLICT/);
  });

  test('AMBIGUOUS — multiple matches abort the run with no ops', async () => {
    stubActiveQuestions([
      goalDoc({ _id: 'oid-1' }),
      goalDoc({ _id: 'oid-2' }),
    ]);

    await expect(
      planBackfill({ only: new Set(['goal_type']) })
    ).rejects.toThrow(/AMBIGUOUS or CONFLICT/);
  });

  test('skips slugs whose fingerprint matches nothing (un-seeded DB)', async () => {
    stubActiveQuestions([]);

    const ops = await planBackfill({ only: new Set(['goal_type']) });

    expect(ops).toHaveLength(0);
  });

  test('--only filter restricts work to the named slugs', async () => {
    // Goal-shaped doc plus a notification-permission doc — both eligible.
    stubActiveQuestions([
      goalDoc(),
      { _id: 'oid-notif', type: 'NOTIFICATION_PERMISSION', text: 'Notifications' },
    ]);

    const onlyGoal = await planBackfill({ only: new Set(['goal_type']) });
    expect(onlyGoal.map((o) => o.slug)).toEqual(['goal_type']);

    const onlyNotif = await planBackfill({
      only: new Set(['notification_permission']),
    });
    expect(onlyNotif.map((o) => o.slug)).toEqual(['notification_permission']);
  });
});
