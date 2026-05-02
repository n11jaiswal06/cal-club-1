// CAL-18 fix: regression tests for getActiveQuestions('PLAN_CREATION'). The
// CAL-18 rate questions (seq 13.3 / 13.5 / 13.7) were silently dropped when
// looked up by _id because the migration upserts on { sequence }, so every
// DB mints its own _ids. We now look those three up by sequence — these
// tests assert the query shape so the bug doesn't regress.
//
// Hermetic: stubs Question.find with jest.spyOn so no Mongo connection is
// needed.

const mongoose = require('mongoose');
const Question = require('../models/schemas/Question');
const OnboardingService = require('../services/onboardingService');

function makeFindStub(rows) {
  // Question.find returns a Query that supports .sort().select().lean().
  return {
    sort: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  };
}

describe("getActiveQuestions('PLAN_CREATION') — lookup wiring", () => {
  let findSpy;
  let capturedFilters;

  beforeEach(() => {
    capturedFilters = [];
    findSpy = jest.spyOn(Question, 'find').mockImplementation((filter) => {
      capturedFilters.push(filter);
      // First call is the plan chain, second is end questions. Return shapes
      // that let the chained .sort().select().lean() resolve to []. Tests
      // inspect the captured filters, not the return rows.
      return makeFindStub([]);
    });
  });

  afterEach(() => {
    findSpy.mockRestore();
  });

  test('plan-chain query is a single $or with stable _ids and CAL-18 sequences', async () => {
    await OnboardingService.getActiveQuestions('PLAN_CREATION');

    // First call hits the plan chain, second call hits the end questions.
    expect(capturedFilters.length).toBe(2);
    const planFilter = capturedFilters[0];

    expect(planFilter.isActive).toBe(true);
    expect(planFilter.$or).toBeDefined();
    expect(planFilter.$or).toHaveLength(2);

    const idClause = planFilter.$or.find((c) => c._id);
    const seqClause = planFilter.$or.find((c) => c.sequence);

    expect(idClause).toBeDefined();
    expect(seqClause).toBeDefined();
    expect(seqClause.sequence.$in).toEqual(
      expect.arrayContaining([13.3, 13.5, 13.7])
    );
    expect(seqClause.sequence.$in).toHaveLength(3);
  });

  test('stable _id list covers demographics + goal + target-weight + CAL-24 trio', async () => {
    await OnboardingService.getActiveQuestions('PLAN_CREATION');

    const planFilter = capturedFilters[0];
    const idClause = planFilter.$or.find((c) => c._id);
    const ids = idClause._id.$in.map((oid) => String(oid));

    // Demographics + goal + target weight. CAL-35 dropped workouts/wk
    // (6908fe66896ccf24778c9076) — standard activity multipliers bake
    // exercise into the activity-level band, so a separate workouts
    // question would double-count.
    expect(ids).toEqual(
      expect.arrayContaining([
        '6908fe66896ccf24778c9075', // gender
        '6908fe66896ccf24778c9077', // typical activity level (rewritten copy in CAL-35)
        '6908fe66896ccf24778c9079', // height + weight
        '6908fe66896ccf24778c907a', // dob
        '6908fe66896ccf24778c907d', // primary goal
        '6908fe66896ccf24778c907f', // target weight
      ])
    );
    expect(ids).not.toContain('6908fe66896ccf24778c9076');

    // CAL-24 trio (migration upserts these by _id, so they're stable).
    expect(ids).toEqual(
      expect.arrayContaining([
        '69f43ca240000000000000a1', // CHOICE_PREVIEW
        '69f43ca240000000000000a3', // HEALTH_PERMISSION_PRIMING
        '69f43ca240000000000000a5', // DATA_IMPORT_STATUS
      ])
    );

    // The wishful CAL-18 IDs that never matched on any DB but the seeder's
    // local one — should NOT appear in the _id list anymore.
    expect(ids).not.toContain('69f43aaf9c78fba92f5c08aa');
    expect(ids).not.toContain('69f43aaf9c78fba92f5c08ab');
    expect(ids).not.toContain('69f43aaf9c78fba92f5c08ac');
  });

  test('end-question query is unchanged (still _id-pinned)', async () => {
    await OnboardingService.getActiveQuestions('PLAN_CREATION');

    const endFilter = capturedFilters[1];
    expect(endFilter._id).toBeDefined();
    expect(endFilter._id.$in).toBeDefined();
    expect(endFilter.$or).toBeUndefined();
    expect(endFilter.isActive).toBe(true);

    const ids = endFilter._id.$in.map((oid) => String(oid));
    expect(ids).toEqual([
      '6908fe66896ccf24778c9085', // GOAL_CALCULATION
      '6908fe66896ccf24778c9086', // PLAN_SUMMARY
    ]);
  });

  test('every $in entry is a real ObjectId (not a string slipping through)', async () => {
    await OnboardingService.getActiveQuestions('PLAN_CREATION');

    const planFilter = capturedFilters[0];
    const idClause = planFilter.$or.find((c) => c._id);
    for (const oid of idClause._id.$in) {
      expect(oid).toBeInstanceOf(mongoose.Types.ObjectId);
    }

    const endFilter = capturedFilters[1];
    for (const oid of endFilter._id.$in) {
      expect(oid).toBeInstanceOf(mongoose.Types.ObjectId);
    }
  });
});
