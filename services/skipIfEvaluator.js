// CAL-32: stateless server-side skipIf evaluator.
//
// Onboarding runs pre-auth (sign-up comes after the questions), so the server
// has no stored UserQuestion rows to read. The client carries its in-progress
// answers and the evaluator is a pure function of (questions, answers).
//
// Rule semantics — single source of truth, mirrored from the schema doc-comment
// on Question.skipIf:
//   * Multiple rules on a question combine as OR (any rule matching → skip).
//   * Within a rule, `valueIn` (semantic) is matched first against the prior
//     answer's `values`. When `valueIn` is non-empty, `textIn` is ignored —
//     `valueIn` takes precedence. `textIn` is the legacy fallback used by
//     pre-CAL-18 rules that were authored before semantic values existed.
//   * `textIn` resolves prior values to `option.text` via the question's
//     `options` (so a stored value like 'static' matches a rule like
//     `textIn: ['Static']`). When no option matches (truly legacy data where
//     the stored value is itself display text), the raw value is tested
//     against `textIn` directly.
//   * Missing prior answer → no rule on it can match → question stays
//     applicable.

const mongoose = require('mongoose');

function toIdString(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();
  if (typeof value.toHexString === 'function') return value.toHexString();
  return String(value);
}

function toPlain(question) {
  if (question && typeof question.toObject === 'function') {
    return question.toObject();
  }
  return { ...question };
}

function buildAnswersByQuestionId(answers) {
  const map = new Map();
  if (!Array.isArray(answers)) return map;
  for (const answer of answers) {
    if (!answer) continue;
    const key = toIdString(answer.questionId);
    if (!key) continue;
    const values = Array.isArray(answer.values) ? answer.values : [];
    map.set(key, values);
  }
  return map;
}

function buildOptionsByQuestionId(questions) {
  const map = new Map();
  if (!Array.isArray(questions)) return map;
  for (const question of questions) {
    if (!question || !question._id) continue;
    const key = toIdString(question._id);
    map.set(key, Array.isArray(question.options) ? question.options : []);
  }
  return map;
}

function ruleMatches(rule, priorValues, priorOptions) {
  if (!Array.isArray(priorValues) || priorValues.length === 0) return false;

  const valueIn = Array.isArray(rule.valueIn) ? rule.valueIn : [];
  const textIn = Array.isArray(rule.textIn) ? rule.textIn : [];

  if (valueIn.length > 0) {
    return priorValues.some((v) => valueIn.includes(v));
  }

  if (textIn.length > 0) {
    return priorValues.some((v) => {
      const option = priorOptions.find((opt) => opt && opt.value === v);
      if (option && typeof option.text === 'string') {
        return textIn.includes(option.text);
      }
      // Legacy fallback: stored value was the display text itself.
      return textIn.includes(v);
    });
  }

  return false;
}

function isQuestionApplicable(question, answersByQuestionId, optionsByQuestionId) {
  const rules = Array.isArray(question.skipIf) ? question.skipIf : [];
  if (rules.length === 0) return true;

  for (const rule of rules) {
    if (!rule || !rule.questionId) continue;
    const priorKey = toIdString(rule.questionId);
    const priorValues = answersByQuestionId.get(priorKey);
    const priorOptions = optionsByQuestionId.get(priorKey) || [];
    if (ruleMatches(rule, priorValues, priorOptions)) {
      return false;
    }
  }
  return true;
}

function evaluateApplicability(questions, answers) {
  if (!Array.isArray(questions)) return [];
  const answersByQuestionId = buildAnswersByQuestionId(answers);
  const optionsByQuestionId = buildOptionsByQuestionId(questions);

  return questions.map((question) => {
    const plain = toPlain(question);
    plain.applicable = isQuestionApplicable(plain, answersByQuestionId, optionsByQuestionId);
    return plain;
  });
}

module.exports = {
  evaluateApplicability,
  isQuestionApplicable,
  // exported for tests
  _internal: {
    buildAnswersByQuestionId,
    buildOptionsByQuestionId,
    ruleMatches,
    toIdString,
  },
};
