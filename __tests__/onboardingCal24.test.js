// CAL-24: schema + migration-shape tests for the Dynamic Goal onboarding
// screens. No DB connection — uses validateSync() and inspects the planned
// ops returned by buildOps().

const mongoose = require('mongoose');
const Question = require('../models/schemas/Question');
const {
  CAL24_CHOICE_ID,
  CAL24_PRIMING_ID,
  CAL24_IMPORT_ID,
  CHOICE_OPTIONS,
  CHOICE_PREVIEW_PAYLOAD,
  PRIMING_PAYLOAD,
  DATA_IMPORT_PAYLOAD,
  buildOps,
  buildChoiceSkipIf,
} = require('../scripts/migrate_onboarding_cal24');

describe('Question schema — CAL-24 types', () => {
  test.each([
    'CHOICE_PREVIEW',
    'HEALTH_PERMISSION_PRIMING',
    'DATA_IMPORT_STATUS',
  ])("accepts type '%s'", (type) => {
    const q = new Question({ text: 'x', type, sequence: 999 });
    const err = q.validateSync();
    expect(err && err.errors && err.errors.type).toBeUndefined();
  });

  test('rejects unknown type', () => {
    const q = new Question({ text: 'x', type: 'NOT_A_TYPE', sequence: 999 });
    const err = q.validateSync();
    expect(err.errors.type).toBeDefined();
    expect(err.errors.type.kind).toBe('enum');
  });

  test('choicePreview sub-schema persists structured fields', () => {
    const q = new Question({
      text: 'choice',
      type: 'CHOICE_PREVIEW',
      sequence: 14.1,
      options: CHOICE_OPTIONS,
      choicePreview: CHOICE_PREVIEW_PAYLOAD,
    });
    expect(q.validateSync()).toBeUndefined();
    expect(q.choicePreview.endpoint).toBe('/goals/choice-preview');
    expect(q.choicePreview.recommendedValue).toBe('dynamic');
    expect(q.choicePreview.dynamicWorkoutLabel).toMatch(/workout day/i);
  });

  test('choicePreview rejects an out-of-enum recommendedValue', () => {
    const q = new Question({
      text: 'choice',
      type: 'CHOICE_PREVIEW',
      sequence: 14.1,
      choicePreview: { ...CHOICE_PREVIEW_PAYLOAD, recommendedValue: 'maybe' },
    });
    const err = q.validateSync();
    expect(err.errors['choicePreview.recommendedValue']).toBeDefined();
    expect(err.errors['choicePreview.recommendedValue'].kind).toBe('enum');
  });

  test('healthPermissionPriming sub-schema persists bullets and CTAs', () => {
    const q = new Question({
      text: 'priming',
      type: 'HEALTH_PERMISSION_PRIMING',
      sequence: 14.3,
      healthPermissionPriming: PRIMING_PAYLOAD,
    });
    expect(q.validateSync()).toBeUndefined();
    expect(q.healthPermissionPriming.bullets.length).toBeGreaterThan(0);
    expect(q.healthPermissionPriming.ctaText).toBe('Connect');
    expect(q.healthPermissionPriming.secondaryCtaText).toMatch(/static/i);
  });

  test('dataImport carries copy for all four lifecycle states', () => {
    const q = new Question({
      text: 'import',
      type: 'DATA_IMPORT_STATUS',
      sequence: 14.5,
      dataImport: DATA_IMPORT_PAYLOAD,
    });
    expect(q.validateSync()).toBeUndefined();
    expect(q.dataImport.importing.heading).toBeTruthy();
    expect(q.dataImport.success.heading).toBeTruthy();
    expect(q.dataImport.permissionDenied.heading).toBeTruthy();
    expect(q.dataImport.syncFailed.heading).toBeTruthy();
  });
});

describe('CAL-24 migration ops', () => {
  const ops = buildOps();
  const byId = Object.fromEntries(
    ops.map((op) => [String(op.filter._id), op])
  );

  test('builds exactly three ops', () => {
    expect(ops).toHaveLength(3);
  });

  test('each op upserts by pre-minted _id', () => {
    for (const op of ops) {
      expect(op.upsert).toBe(true);
      expect(op.filter._id).toBeInstanceOf(mongoose.Types.ObjectId);
    }
    expect(byId[CAL24_CHOICE_ID]).toBeDefined();
    expect(byId[CAL24_PRIMING_ID]).toBeDefined();
    expect(byId[CAL24_IMPORT_ID]).toBeDefined();
  });

  test('sequences slot between recomp INFO_SCREEN (13.7) and GOAL_CALCULATION (~15)', () => {
    expect(byId[CAL24_CHOICE_ID].update.$set.sequence).toBe(14.1);
    expect(byId[CAL24_PRIMING_ID].update.$set.sequence).toBe(14.3);
    expect(byId[CAL24_IMPORT_ID].update.$set.sequence).toBe(14.5);
  });

  test('choice screen carries options + structured choicePreview payload', () => {
    const set = byId[CAL24_CHOICE_ID].update.$set;
    expect(set.type).toBe('CHOICE_PREVIEW');
    expect(set.options.map((o) => o.value).sort()).toEqual(['dynamic', 'static']);
    expect(set.choicePreview.recommendedValue).toBe('dynamic');
    expect(set.choicePreview.staticLabel).toBeTruthy();
    expect(set.choicePreview.dynamicRestLabel).toBeTruthy();
    expect(set.choicePreview.dynamicActiveLabel).toBeTruthy();
    expect(set.choicePreview.dynamicWorkoutLabel).toBeTruthy();
    // Choice screen has no skipIf — it's the gate.
    expect(set.skipIf).toBeUndefined();
  });

  test('priming + import skip when user picks static', () => {
    const primingSkip = byId[CAL24_PRIMING_ID].update.$set.skipIf;
    const importSkip = byId[CAL24_IMPORT_ID].update.$set.skipIf;
    for (const skip of [primingSkip, importSkip]) {
      expect(skip).toHaveLength(1);
      expect(String(skip[0].questionId)).toBe(CAL24_CHOICE_ID);
      expect(skip[0].valueIn).toEqual(['static']);
      expect(skip[0].textIn).toEqual(['Static']);
    }
  });

  test('import question carries per-state copy in dataImport, not separate rows', () => {
    const set = byId[CAL24_IMPORT_ID].update.$set;
    expect(set.type).toBe('DATA_IMPORT_STATUS');
    expect(set.dataImport.importing).toBeDefined();
    expect(set.dataImport.success).toBeDefined();
    expect(set.dataImport.permissionDenied).toBeDefined();
    expect(set.dataImport.syncFailed).toBeDefined();
  });

  test('priming type matches PRD §6.5 and renders steps/workouts copy', () => {
    const set = byId[CAL24_PRIMING_ID].update.$set;
    expect(set.type).toBe('HEALTH_PERMISSION_PRIMING');
    expect(set.healthPermissionPriming.body).toMatch(/steps and workouts/i);
  });
});

describe('buildChoiceSkipIf helper', () => {
  test('emits a single rule pinning the choice question', () => {
    const rule = buildChoiceSkipIf(['static']);
    expect(rule).toHaveLength(1);
    expect(String(rule[0].questionId)).toBe(CAL24_CHOICE_ID);
    expect(rule[0].valueIn).toEqual(['static']);
    expect(rule[0].textIn).toEqual(['Static']);
  });

  test('valueIn passes through unknown values without crashing', () => {
    // textIn falls back to whatever it can map; unmapped values just get dropped.
    const rule = buildChoiceSkipIf(['static', 'mystery']);
    expect(rule[0].valueIn).toEqual(['static', 'mystery']);
    expect(rule[0].textIn).toEqual(['Static']);
  });
});
