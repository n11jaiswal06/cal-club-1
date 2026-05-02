// CAL-33 — pure-function tests for the target-weight validator. No DB,
// no HTTP — exercises validateTargetWeight() against fabricated
// (validation, goal, current weight, target) tuples.

const { validateTargetWeight, CODE, FIELD } = require('../services/targetWeightValidator');

const baseValidation = Object.freeze({
  minValue: 30,
  maxValue: 250,
  requireGoalDirection: {
    goalQuestionSlug: 'goal_type',
    currentWeightQuestionSlug: 'height_weight',
    minDeltaKg: 0.5
  },
  copy: {
    outOfRange: 'Pick between {min} and {max} kg.',
    invalidForLose: 'Lose-fat targets must be lower than current.',
    invalidForGain: 'Gain-muscle targets must be higher than current.',
    invalidForNonDirectional: 'Not used for this goal.',
    minDelta: 'At least {minDelta} kg away from current.',
    missingCurrentWeight: 'Add current weight first.',
    missingGoal: 'Pick a goal first.'
  }
});

function codes(result) {
  return result.errors.map(e => e.code);
}

describe('validateTargetWeight — accept paths', () => {
  test('lose: target strictly below current and beyond minDelta passes', () => {
    const r = validateTargetWeight({
      targetKg: 65,
      currentKg: 70,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  test('gain: target strictly above current and beyond minDelta passes', () => {
    const r = validateTargetWeight({
      targetKg: 80,
      currentKg: 70,
      goalValue: 'gain',
      validation: baseValidation
    });
    expect(r.valid).toBe(true);
  });

  test('lose at exact min boundary passes', () => {
    const r = validateTargetWeight({
      targetKg: 30,
      currentKg: 80,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(r.valid).toBe(true);
  });

  test('gain at exact max boundary passes', () => {
    const r = validateTargetWeight({
      targetKg: 250,
      currentKg: 200,
      goalValue: 'gain',
      validation: baseValidation
    });
    expect(r.valid).toBe(true);
  });

  test('no validation payload → accept (FE picker would not constrain either)', () => {
    const r = validateTargetWeight({
      targetKg: 9999,
      currentKg: 70,
      goalValue: 'lose',
      validation: null
    });
    expect(r.valid).toBe(true);
  });
});

describe('validateTargetWeight — direction violations', () => {
  test('lose: target equal to current is rejected (INVALID_FOR_GOAL)', () => {
    const r = validateTargetWeight({
      targetKg: 70,
      currentKg: 70,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(r.valid).toBe(false);
    expect(codes(r)).toContain(CODE.INVALID_FOR_GOAL);
    const e = r.errors.find(e => e.code === CODE.INVALID_FOR_GOAL);
    expect(e.field).toBe(FIELD);
    expect(e.message).toBe('Lose-fat targets must be lower than current.');
  });

  test('lose: target above current is rejected', () => {
    const r = validateTargetWeight({
      targetKg: 75,
      currentKg: 70,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.INVALID_FOR_GOAL);
  });

  test('gain: target equal to current is rejected', () => {
    const r = validateTargetWeight({
      targetKg: 70,
      currentKg: 70,
      goalValue: 'gain',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.INVALID_FOR_GOAL);
    expect(r.errors[0].message).toBe('Gain-muscle targets must be higher than current.');
  });

  test('gain: target below current is rejected', () => {
    const r = validateTargetWeight({
      targetKg: 65,
      currentKg: 70,
      goalValue: 'gain',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.INVALID_FOR_GOAL);
  });
});

describe('validateTargetWeight — minDelta enforcement', () => {
  test('lose: 0.1 kg below current (within minDelta) is rejected', () => {
    const r = validateTargetWeight({
      targetKg: 69.9,
      currentKg: 70,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.MIN_DELTA);
    expect(r.errors[0].message).toBe('At least 0.5 kg away from current.');
  });

  test('gain: 0.1 kg above current (within minDelta) is rejected', () => {
    const r = validateTargetWeight({
      targetKg: 70.1,
      currentKg: 70,
      goalValue: 'gain',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.MIN_DELTA);
  });

  test('lose: exactly minDelta kg below current passes', () => {
    const r = validateTargetWeight({
      targetKg: 69.5,
      currentKg: 70,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(r.valid).toBe(true);
  });

  test('minDeltaKg=0 disables the delta check (direction still enforced)', () => {
    const noDelta = {
      ...baseValidation,
      requireGoalDirection: {
        ...baseValidation.requireGoalDirection,
        minDeltaKg: 0
      }
    };
    const r = validateTargetWeight({
      targetKg: 69.99,
      currentKg: 70,
      goalValue: 'lose',
      validation: noDelta
    });
    expect(r.valid).toBe(true);
  });
});

describe('validateTargetWeight — non-directional goals', () => {
  test('recomp: target submitted is rejected with INVALID_FOR_NON_DIRECTIONAL_GOAL', () => {
    const r = validateTargetWeight({
      targetKg: 65,
      currentKg: 70,
      goalValue: 'recomp',
      validation: baseValidation
    });
    expect(r.valid).toBe(false);
    expect(codes(r)).toContain(CODE.INVALID_FOR_NON_DIRECTIONAL_GOAL);
  });

  test('maintain: target submitted is rejected', () => {
    const r = validateTargetWeight({
      targetKg: 70,
      currentKg: 70,
      goalValue: 'maintain',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.INVALID_FOR_NON_DIRECTIONAL_GOAL);
  });

  test('unknown goal value: no direction constraint (forward-compat), bounds still enforced', () => {
    const r = validateTargetWeight({
      targetKg: 70,
      currentKg: 70,
      goalValue: 'futureGoal',
      validation: baseValidation
    });
    expect(r.valid).toBe(true);
  });
});

describe('validateTargetWeight — absolute bounds', () => {
  test('below minValue is rejected with OUT_OF_RANGE', () => {
    const r = validateTargetWeight({
      targetKg: 25,
      currentKg: 80,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.OUT_OF_RANGE);
    expect(r.errors[0].message).toBe('Pick between 30 and 250 kg.');
  });

  test('above maxValue is rejected', () => {
    const r = validateTargetWeight({
      targetKg: 300,
      currentKg: 200,
      goalValue: 'gain',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.OUT_OF_RANGE);
  });

  test('out-of-range AND wrong direction → both errors reported', () => {
    const r = validateTargetWeight({
      targetKg: 300,
      currentKg: 70,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.OUT_OF_RANGE);
    expect(codes(r)).toContain(CODE.INVALID_FOR_GOAL);
  });
});

describe('validateTargetWeight — missing inputs', () => {
  test('missing goal with direction rule active → MISSING_GOAL', () => {
    const r = validateTargetWeight({
      targetKg: 65,
      currentKg: 70,
      goalValue: null,
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.MISSING_GOAL);
  });

  test('missing current weight with directional goal → MISSING_CURRENT_WEIGHT', () => {
    const r = validateTargetWeight({
      targetKg: 65,
      currentKg: null,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(codes(r)).toContain(CODE.MISSING_CURRENT_WEIGHT);
  });

  test('non-numeric target → INVALID_NUMBER, no other checks', () => {
    const r = validateTargetWeight({
      targetKg: 'abc',
      currentKg: 70,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(r.valid).toBe(false);
    expect(codes(r)).toEqual([CODE.INVALID_NUMBER]);
  });

  test('zero target → INVALID_NUMBER', () => {
    const r = validateTargetWeight({
      targetKg: 0,
      currentKg: 70,
      goalValue: 'lose',
      validation: baseValidation
    });
    expect(codes(r)).toEqual([CODE.INVALID_NUMBER]);
  });
});

describe('validateTargetWeight — copy fallbacks', () => {
  test('missing copy on validation falls back to default English', () => {
    const v = { ...baseValidation, copy: undefined };
    const r = validateTargetWeight({
      targetKg: 75,
      currentKg: 70,
      goalValue: 'lose',
      validation: v
    });
    const e = r.errors.find(e => e.code === CODE.INVALID_FOR_GOAL);
    expect(e.message).toMatch(/lose-fat targets must be lower/i);
  });

  test('placeholder substitution works for both server-provided and fallback copy', () => {
    const v = {
      ...baseValidation,
      copy: { ...baseValidation.copy, outOfRange: 'Range: {min}..{max}, you sent {value}.' }
    };
    const r = validateTargetWeight({
      targetKg: 25,
      currentKg: 80,
      goalValue: 'lose',
      validation: v
    });
    const e = r.errors.find(e => e.code === CODE.OUT_OF_RANGE);
    expect(e.message).toBe('Range: 30..250, you sent 25.');
  });
});
