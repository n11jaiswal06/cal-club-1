// Unit tests for the meal-title sanitizer. Covers both the regex-based
// generic-title detector and the role-aware rebuild fallback. Pure functions —
// no network, no database, no LLM calls.

// AiService instantiates SDK clients at module load, which assert credentials
// exist. Set dummies before the require so the module can initialize in Jest.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'dummy';
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'dummy';

const AiService = require('../services/aiService');

describe('GENERIC_TITLE_REGEX', () => {
  const matches = [
    'Indian meal',
    'Asian bowl',
    'Healthy bowl',
    'Lunch plate',
    'Breakfast',
    'Dinner',
    'Snack',
    'Lunch',
    'Mixed meal',
    'Balanced dinner',
    'Protein bowl',
    'Vegetarian Meal',
    'Vegan Dish',
    'Breakfast bowl',
    'Quick snack',
    'Combo',
    'Platter',
    '  Indian meal  ',   // whitespace around
    'INDIAN MEAL',        // case-insensitive
  ];

  const passes = [
    'Chicken Biryani',
    'Dal & Rice',
    'Paneer Tikka',
    'Grilled Chicken Salad',
    'Oats with Peanut Butter',
    'Spiced Chicken Dinner Plate', // "Spiced Chicken" breaks anchor
    'Whole Truth Protein',          // "Whole" not in adjective list
    'Boiled eggs, bread and ketchup',
    'Assorted Fruits and Snacks',
    'Buttermilk',
    'Indian Thali Meal',            // extra word breaks anchor
  ];

  test.each(matches)('catches "%s"', (title) => {
    expect(AiService.GENERIC_TITLE_REGEX.test(title)).toBe(true);
  });

  test.each(passes)('passes through "%s"', (title) => {
    expect(AiService.GENERIC_TITLE_REGEX.test(title)).toBe(false);
  });
});

describe('rebuildTitleFromItems', () => {
  test('takes first 2 role=main items, joins with " & "', () => {
    const items = [
      { name: 'Roti', role: 'main' },
      { name: 'Chicken Curry', role: 'main' },
      { name: 'Pickle', role: 'side' },
    ];
    expect(AiService.rebuildTitleFromItems(items)).toBe('Roti & Chicken Curry');
  });

  test('returns just the name when only 1 main exists', () => {
    const items = [
      { name: 'Chicken Biryani', role: 'main' },
      { name: 'Raita', role: 'side' },
    ];
    expect(AiService.rebuildTitleFromItems(items)).toBe('Chicken Biryani');
  });

  test('ignores sides and condiments even when calorie-dense', () => {
    const items = [
      { name: 'Salad Greens', role: 'main' },
      { name: 'Grilled Chicken', role: 'main' },
      { name: 'Mayo Dressing', role: 'condiment' },
    ];
    expect(AiService.rebuildTitleFromItems(items)).toBe('Salad Greens & Grilled Chicken');
  });

  test('falls back to full item list when no role is tagged (legacy meals)', () => {
    const items = [
      { name: 'Roti' },
      { name: 'Chicken Curry' },
      { name: 'Pickle' },
    ];
    expect(AiService.rebuildTitleFromItems(items)).toBe('Roti & Chicken Curry');
  });

  test('falls back to any item with a name when no role=main exists', () => {
    const items = [
      { name: 'Mayo', role: 'condiment' },
      { name: 'Ketchup', role: 'condiment' },
    ];
    expect(AiService.rebuildTitleFromItems(items)).toBe('Mayo & Ketchup');
  });

  test('returns "Meal" for empty or missing items', () => {
    expect(AiService.rebuildTitleFromItems([])).toBe('Meal');
    expect(AiService.rebuildTitleFromItems(null)).toBe('Meal');
    expect(AiService.rebuildTitleFromItems(undefined)).toBe('Meal');
  });

  test('returns "Meal" when items have no names', () => {
    expect(AiService.rebuildTitleFromItems([{ role: 'main' }, { role: 'main' }])).toBe('Meal');
  });

  test('skips null/falsy entries in the array', () => {
    const items = [null, { name: 'Toast', role: 'main' }, undefined];
    expect(AiService.rebuildTitleFromItems(items)).toBe('Toast');
  });
});

describe('sanitizeMealTitle', () => {
  const items = [
    { name: 'Chicken Curry', role: 'main' },
    { name: 'Roti', role: 'main' },
  ];

  test('passes through a specific title unchanged', () => {
    expect(AiService.sanitizeMealTitle('Chicken Biryani', items)).toBe('Chicken Biryani');
  });

  test('rebuilds from items when title is generic', () => {
    expect(AiService.sanitizeMealTitle('Indian meal', items)).toBe('Chicken Curry & Roti');
  });

  test('rebuilds when title is empty', () => {
    expect(AiService.sanitizeMealTitle('', items)).toBe('Chicken Curry & Roti');
  });

  test('rebuilds when title is null', () => {
    expect(AiService.sanitizeMealTitle(null, items)).toBe('Chicken Curry & Roti');
  });

  test('trims whitespace on passthrough', () => {
    expect(AiService.sanitizeMealTitle('  Chicken Biryani  ', items)).toBe('Chicken Biryani');
  });

  test('rebuilds "Lunch plate" (mealtype + generic-noun)', () => {
    expect(AiService.sanitizeMealTitle('Lunch plate', items)).toBe('Chicken Curry & Roti');
  });

  test('rebuilds "Breakfast bowl" (mealtype + generic-noun)', () => {
    expect(AiService.sanitizeMealTitle('Breakfast bowl', items)).toBe('Chicken Curry & Roti');
  });
});
