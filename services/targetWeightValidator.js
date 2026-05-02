// CAL-33: pure-function validator for target weight.
//
// The target-weight PICKER is server-driven (see Question.validation, set by
// scripts/migrate_onboarding_cal33.js). This module is the single source of
// truth that decides whether a submitted target weight is acceptable, given:
//   • the absolute min/max bounds carried on the question,
//   • the user's goal direction (lose → desired < current; gain → desired
//     > current; recomp/maintain → question should have been skipped),
//   • a sane minimum delta from the user's current weight.
//
// Used in two places:
//   1. OnboardingService.saveUserAnswers — synchronous gate before persisting
//      the target_weight UserQuestion row, returning a 422 with {field, code}
//      so the FE can render the right copy and unblock the picker.
//   2. The Flutter onboarding bloc — reads Question.validation from the
//      /onboarding/questions payload and constrains the picker pre-tap. The
//      same numbers used here come from there, so the two sides agree.
//
// All inputs are plain primitives and the function is side-effect-free, so
// tests don't need a DB.

// Stable error codes. Frontend binds copy to these codes and shows the
// matching server-supplied message from `Question.validation.copy`.
const CODE = Object.freeze({
  MISSING_GOAL: 'MISSING_GOAL',
  MISSING_CURRENT_WEIGHT: 'MISSING_CURRENT_WEIGHT',
  INVALID_FOR_GOAL: 'INVALID_FOR_GOAL',
  INVALID_FOR_NON_DIRECTIONAL_GOAL: 'INVALID_FOR_NON_DIRECTIONAL_GOAL',
  MIN_DELTA: 'MIN_DELTA',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  INVALID_NUMBER: 'INVALID_NUMBER'
});

const FIELD = 'desired_weight_kg';

const FALLBACK_COPY = Object.freeze({
  outOfRange: 'Pick a target weight between {min} and {max} kg.',
  invalidForLose: 'Lose-fat targets must be lower than your current weight.',
  invalidForGain: 'Gain-muscle targets must be higher than your current weight.',
  invalidForNonDirectional: 'Target weight is not used for this goal type.',
  minDelta: 'Pick a target at least {minDelta} kg away from your current weight.',
  missingCurrentWeight: 'Add your current weight before setting a target.',
  missingGoal: 'Pick a goal before setting a target weight.'
});

function format(template, vars) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match
  );
}

function pickCopy(validationCopy, key) {
  const fromDoc = validationCopy && typeof validationCopy[key] === 'string' && validationCopy[key].trim();
  return fromDoc || FALLBACK_COPY[key];
}

function err(code, copyKey, copy, vars = {}) {
  return {
    field: FIELD,
    code,
    message: format(pickCopy(copy, copyKey), vars)
  };
}

// `goalValue` is the semantic value of the goal-type answer
// ('lose' | 'gain' | 'recomp' | 'maintain'). 'recomp' and 'maintain' are
// "non-directional" — the target-weight question is skipped for them; if
// a target is submitted anyway, that's a client bug and we reject loudly.
const DIRECTIONAL_GOALS = new Set(['lose', 'gain']);
const NON_DIRECTIONAL_GOALS = new Set(['recomp', 'maintain']);

function validateTargetWeight({
  targetKg,
  currentKg,
  goalValue,
  validation
}) {
  const v = validation || {};
  const copy = v.copy || {};
  const errors = [];

  const target = Number(targetKg);
  if (!Number.isFinite(target) || target <= 0) {
    errors.push({ field: FIELD, code: CODE.INVALID_NUMBER, message: 'Target weight must be a positive number.' });
    return { valid: false, errors };
  }

  // Absolute bounds. Always enforced when configured.
  const min = Number.isFinite(v.minValue) ? v.minValue : null;
  const max = Number.isFinite(v.maxValue) ? v.maxValue : null;
  if ((min !== null && target < min) || (max !== null && target > max)) {
    errors.push(err(CODE.OUT_OF_RANGE, 'outOfRange', copy, {
      min: min ?? '–',
      max: max ?? '–',
      value: target
    }));
  }

  const direction = v.requireGoalDirection;
  if (direction) {
    // Goal must be present.
    if (!goalValue) {
      errors.push(err(CODE.MISSING_GOAL, 'missingGoal', copy));
      return { valid: false, errors };
    }

    // Non-directional goals: question should have been skipped (CAL-18 skipIf).
    // Hard-reject so a misbehaving client surfaces fast.
    if (NON_DIRECTIONAL_GOALS.has(goalValue)) {
      errors.push(err(CODE.INVALID_FOR_NON_DIRECTIONAL_GOAL, 'invalidForNonDirectional', copy, { goal: goalValue }));
      return { valid: false, errors };
    }

    if (DIRECTIONAL_GOALS.has(goalValue)) {
      const current = Number(currentKg);
      if (!Number.isFinite(current) || current <= 0) {
        errors.push(err(CODE.MISSING_CURRENT_WEIGHT, 'missingCurrentWeight', copy));
        return { valid: false, errors };
      }

      const minDelta = Number.isFinite(direction.minDeltaKg) ? direction.minDeltaKg : 0;
      if (goalValue === 'lose') {
        if (target >= current) {
          errors.push(err(CODE.INVALID_FOR_GOAL, 'invalidForLose', copy, { current, target }));
        } else if (minDelta > 0 && (current - target) < minDelta) {
          errors.push(err(CODE.MIN_DELTA, 'minDelta', copy, { current, target, minDelta }));
        }
      } else if (goalValue === 'gain') {
        if (target <= current) {
          errors.push(err(CODE.INVALID_FOR_GOAL, 'invalidForGain', copy, { current, target }));
        } else if (minDelta > 0 && (target - current) < minDelta) {
          errors.push(err(CODE.MIN_DELTA, 'minDelta', copy, { current, target, minDelta }));
        }
      }
    }
    // Unknown goal value (forward-compatibility): no direction constraint.
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  validateTargetWeight,
  CODE,
  FIELD,
  FALLBACK_COPY
};
