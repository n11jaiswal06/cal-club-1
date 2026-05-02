// CAL-32 — pure-function tests for the stateless skipIf evaluator.
// No DB, no HTTP — exercises evaluateApplicability() against fabricated
// question/answer fixtures that mirror the canonical seeds (CAL-18 goal
// branching, CAL-24 dynamic-vs-static).

const mongoose = require('mongoose');
const { evaluateApplicability, isQuestionApplicable } = require('../services/skipIfEvaluator');

const oid = (hex) => new mongoose.Types.ObjectId(hex);

const GOAL_ID = oid('6908fe66896ccf24778c907d');
const TARGET_WEIGHT_ID = oid('6908fe66896ccf24778c907f');
const RATE_LOSS_ID = oid('6908fe66896ccf24778c9001');
const RATE_GAIN_ID = oid('6908fe66896ccf24778c9002');
const RECOMP_INFO_ID = oid('6908fe66896ccf24778c9003');
const CHOICE_ID = oid('69f43ca240000000000000a1');
const PRIMING_ID = oid('69f43ca240000000000000a3');
const IMPORT_ID = oid('69f43ca240000000000000a5');

const goalQuestion = {
  _id: GOAL_ID,
  slug: 'goal_type',
  sequence: 10,
  text: "What's your primary goal?",
  options: [
    { text: 'Lose fat', value: 'lose' },
    { text: 'Gain muscle', value: 'gain' },
    { text: 'Build muscle while losing weight', value: 'recomp' },
    { text: 'Maintain', value: 'maintain' },
  ],
  skipIf: [],
};

const targetWeightQuestion = {
  _id: TARGET_WEIGHT_ID,
  slug: 'target_weight',
  sequence: 11,
  text: "What's your target weight?",
  options: [],
  skipIf: [
    { questionId: GOAL_ID, valueIn: ['maintain', 'recomp'], textIn: [] },
  ],
};

const rateLossQuestion = {
  _id: RATE_LOSS_ID,
  slug: 'rate_loss',
  sequence: 13.3,
  text: 'How fast do you want to lose?',
  options: [],
  skipIf: [
    { questionId: GOAL_ID, valueIn: ['gain', 'recomp', 'maintain'], textIn: [] },
  ],
};

const rateGainQuestion = {
  _id: RATE_GAIN_ID,
  slug: 'rate_gain',
  sequence: 13.5,
  text: 'How fast do you want to gain?',
  options: [],
  skipIf: [
    { questionId: GOAL_ID, valueIn: ['lose', 'recomp', 'maintain'], textIn: [] },
  ],
};

const recompInfoQuestion = {
  _id: RECOMP_INFO_ID,
  slug: 'recomp_expectation',
  sequence: 13.7,
  text: 'About body recomposition…',
  options: [],
  skipIf: [
    { questionId: GOAL_ID, valueIn: ['lose', 'gain', 'maintain'], textIn: [] },
  ],
};

const choiceQuestion = {
  _id: CHOICE_ID,
  slug: 'plan_choice',
  sequence: 14.1,
  text: 'Choose dynamic or static',
  options: [
    { text: 'Dynamic', value: 'dynamic' },
    { text: 'Static', value: 'static' },
  ],
  skipIf: [],
};

const primingQuestion = {
  _id: PRIMING_ID,
  slug: 'health_priming',
  sequence: 14.3,
  text: 'Health permission priming',
  options: [],
  skipIf: [
    { questionId: CHOICE_ID, valueIn: ['static'], textIn: [] },
  ],
};

const importQuestion = {
  _id: IMPORT_ID,
  slug: 'data_import',
  sequence: 14.5,
  text: 'Data import status',
  options: [],
  skipIf: [
    { questionId: CHOICE_ID, valueIn: ['static'], textIn: [] },
  ],
};

const planChain = [
  goalQuestion,
  targetWeightQuestion,
  rateLossQuestion,
  rateGainQuestion,
  recompInfoQuestion,
  choiceQuestion,
  primingQuestion,
  importQuestion,
];

function applicabilityBySlug(annotated) {
  const out = {};
  for (const q of annotated) out[q.slug] = q.applicable;
  return out;
}

describe('skipIfEvaluator — CAL-18 goal branching', () => {
  test('goal=maintain hides target_weight, rate_loss, rate_gain, recomp_expectation', () => {
    const result = evaluateApplicability(planChain, [
      { questionId: GOAL_ID.toString(), values: ['maintain'] },
    ]);
    const a = applicabilityBySlug(result);
    expect(a.goal_type).toBe(true);
    expect(a.target_weight).toBe(false);
    expect(a.rate_loss).toBe(false);
    expect(a.rate_gain).toBe(false);
    expect(a.recomp_expectation).toBe(false);
  });

  test('goal=recomp hides target_weight, rate_loss, rate_gain but shows recomp_expectation', () => {
    const result = evaluateApplicability(planChain, [
      { questionId: GOAL_ID.toString(), values: ['recomp'] },
    ]);
    const a = applicabilityBySlug(result);
    expect(a.target_weight).toBe(false);
    expect(a.rate_loss).toBe(false);
    expect(a.rate_gain).toBe(false);
    expect(a.recomp_expectation).toBe(true);
  });

  test('goal=lose shows target_weight + rate_loss, hides rate_gain + recomp_expectation', () => {
    const result = evaluateApplicability(planChain, [
      { questionId: GOAL_ID.toString(), values: ['lose'] },
    ]);
    const a = applicabilityBySlug(result);
    expect(a.target_weight).toBe(true);
    expect(a.rate_loss).toBe(true);
    expect(a.rate_gain).toBe(false);
    expect(a.recomp_expectation).toBe(false);
  });

  test('goal=gain shows target_weight + rate_gain, hides rate_loss + recomp_expectation', () => {
    const result = evaluateApplicability(planChain, [
      { questionId: GOAL_ID.toString(), values: ['gain'] },
    ]);
    const a = applicabilityBySlug(result);
    expect(a.target_weight).toBe(true);
    expect(a.rate_loss).toBe(false);
    expect(a.rate_gain).toBe(true);
    expect(a.recomp_expectation).toBe(false);
  });
});

describe('skipIfEvaluator — CAL-24 dynamic-vs-static branching', () => {
  test('choice=static hides priming and import screens', () => {
    const result = evaluateApplicability(planChain, [
      { questionId: CHOICE_ID.toString(), values: ['static'] },
    ]);
    const a = applicabilityBySlug(result);
    expect(a.health_priming).toBe(false);
    expect(a.data_import).toBe(false);
  });

  test('choice=dynamic keeps priming and import applicable', () => {
    const result = evaluateApplicability(planChain, [
      { questionId: CHOICE_ID.toString(), values: ['dynamic'] },
    ]);
    const a = applicabilityBySlug(result);
    expect(a.health_priming).toBe(true);
    expect(a.data_import).toBe(true);
  });
});

describe('skipIfEvaluator — semantics edge cases', () => {
  test('valueIn precedence: textIn is ignored when valueIn is non-empty', () => {
    const question = {
      _id: oid('6908fe66896ccf24778c9100'),
      slug: 'precedence_check',
      options: [],
      skipIf: [
        {
          questionId: GOAL_ID,
          valueIn: ['lose'],            // does not match
          textIn: ['Maintain'],          // would match if consulted (option.text for 'maintain')
        },
      ],
    };
    const result = evaluateApplicability([goalQuestion, question], [
      { questionId: GOAL_ID.toString(), values: ['maintain'] },
    ]);
    expect(result.find((q) => q.slug === 'precedence_check').applicable).toBe(true);
  });

  test('multiple rules OR: first rule matches → skipped even if second rule does not', () => {
    const question = {
      _id: oid('6908fe66896ccf24778c9101'),
      slug: 'or_rules',
      options: [],
      skipIf: [
        { questionId: GOAL_ID, valueIn: ['maintain'], textIn: [] },
        { questionId: CHOICE_ID, valueIn: ['static'], textIn: [] },
      ],
    };
    const result = evaluateApplicability([goalQuestion, choiceQuestion, question], [
      { questionId: GOAL_ID.toString(), values: ['maintain'] },
      { questionId: CHOICE_ID.toString(), values: ['dynamic'] },
    ]);
    expect(result.find((q) => q.slug === 'or_rules').applicable).toBe(false);
  });

  test('missing prior answer leaves question applicable', () => {
    const result = evaluateApplicability(planChain, []);
    const a = applicabilityBySlug(result);
    expect(a.target_weight).toBe(true);
    expect(a.rate_loss).toBe(true);
    expect(a.health_priming).toBe(true);
  });

  test('empty values array on a prior answer behaves like missing answer', () => {
    const result = evaluateApplicability(planChain, [
      { questionId: GOAL_ID.toString(), values: [] },
    ]);
    expect(applicabilityBySlug(result).target_weight).toBe(true);
  });

  test('legacy textIn rule resolves prior value to option.text', () => {
    const legacyQuestion = {
      _id: oid('6908fe66896ccf24778c9102'),
      slug: 'legacy_text_in',
      options: [],
      skipIf: [
        // No valueIn — pre-CAL-18 rule shape, only textIn.
        { questionId: GOAL_ID, valueIn: [], textIn: ['Maintain'] },
      ],
    };
    // Prior answer carries the semantic value 'maintain'; evaluator must map
    // that to option.text 'Maintain' via goalQuestion.options before testing.
    const result = evaluateApplicability([goalQuestion, legacyQuestion], [
      { questionId: GOAL_ID.toString(), values: ['maintain'] },
    ]);
    expect(result.find((q) => q.slug === 'legacy_text_in').applicable).toBe(false);
  });

  test('legacy textIn rule falls back to raw value when no option matches', () => {
    // Question with options that do not carry semantic `value` fields, so
    // historical answers stored display text directly. The rule's textIn must
    // still match.
    const trulyLegacyGoal = {
      _id: oid('6908fe66896ccf24778c9103'),
      slug: 'legacy_goal',
      options: [
        { text: 'Lose fat' },     // no value field
        { text: 'Maintain' },     // no value field
      ],
      skipIf: [],
    };
    const dependent = {
      _id: oid('6908fe66896ccf24778c9104'),
      slug: 'legacy_dependent',
      options: [],
      skipIf: [
        { questionId: trulyLegacyGoal._id, valueIn: [], textIn: ['Maintain'] },
      ],
    };
    const result = evaluateApplicability([trulyLegacyGoal, dependent], [
      { questionId: trulyLegacyGoal._id.toString(), values: ['Maintain'] },
    ]);
    expect(result.find((q) => q.slug === 'legacy_dependent').applicable).toBe(false);
  });

  test('multi-value prior answer: rule matches if any value is in valueIn', () => {
    // Forward-compatibility for multi-select onboarding questions: a prior
    // answer's `values` array can carry more than one entry, and the rule
    // matches when *any* of those values intersects valueIn.
    const multiQuestion = {
      _id: oid('6908fe66896ccf24778c9106'),
      slug: 'multi_select_source',
      options: [
        { text: 'Strength', value: 'strength' },
        { text: 'Cardio', value: 'cardio' },
        { text: 'Yoga', value: 'yoga' },
      ],
      skipIf: [],
    };
    const dependent = {
      _id: oid('6908fe66896ccf24778c9107'),
      slug: 'multi_dependent',
      options: [],
      skipIf: [
        // Skip the dependent question if the user picked cardio (alongside anything else).
        { questionId: multiQuestion._id, valueIn: ['cardio'], textIn: [] },
      ],
    };
    const result = evaluateApplicability([multiQuestion, dependent], [
      { questionId: multiQuestion._id.toString(), values: ['strength', 'cardio'] },
    ]);
    expect(result.find((q) => q.slug === 'multi_dependent').applicable).toBe(false);

    const noMatch = evaluateApplicability([multiQuestion, dependent], [
      { questionId: multiQuestion._id.toString(), values: ['strength', 'yoga'] },
    ]);
    expect(noMatch.find((q) => q.slug === 'multi_dependent').applicable).toBe(true);
  });

  test('rule with both valueIn and textIn empty is a no-op', () => {
    const question = {
      _id: oid('6908fe66896ccf24778c9105'),
      slug: 'empty_rule',
      options: [],
      skipIf: [{ questionId: GOAL_ID, valueIn: [], textIn: [] }],
    };
    const result = evaluateApplicability([goalQuestion, question], [
      { questionId: GOAL_ID.toString(), values: ['maintain'] },
    ]);
    expect(result.find((q) => q.slug === 'empty_rule').applicable).toBe(true);
  });

  test('isQuestionApplicable handles questions with no skipIf array', () => {
    const out = isQuestionApplicable({ _id: 'x' }, new Map(), new Map());
    expect(out).toBe(true);
  });

  test('evaluateApplicability returns plain objects for Mongoose-doc-shaped inputs', () => {
    // Simulate a Mongoose document by attaching toObject().
    const docLike = {
      _id: targetWeightQuestion._id,
      slug: 'target_weight',
      skipIf: targetWeightQuestion.skipIf,
      options: [],
      toObject() {
        return {
          _id: this._id,
          slug: this.slug,
          skipIf: this.skipIf,
          options: this.options,
        };
      },
    };
    const result = evaluateApplicability([goalQuestion, docLike], [
      { questionId: GOAL_ID.toString(), values: ['maintain'] },
    ]);
    const target = result.find((q) => q.slug === 'target_weight');
    expect(target.applicable).toBe(false);
    // Plain object: not the original docLike, no leaked toObject method.
    expect(typeof target.toObject).toBe('undefined');
  });

  test('non-array questions input returns []', () => {
    expect(evaluateApplicability(null, [])).toEqual([]);
    expect(evaluateApplicability(undefined, [])).toEqual([]);
  });
});
