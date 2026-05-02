// CAL-27/28: hero section calories payload shape.
//
// Verifies that formatHeroSectionWidget folds the dynamicGoal block
// into the hero calories payload (under a `dynamic` sub-object that
// mirrors /app/progress.dynamicGoal) for dynamic users and emits a
// clean static payload (no `+ burn` additive, dynamic: null) for
// static users.

jest.mock('../services/heroBriefService', () => ({
  getOrGenerateBrief: jest.fn(),
  getAvailablePhaseTabs: jest.fn()
}));

const HeroBriefService = require('../services/heroBriefService');
const AppFormatService = require('../services/appFormatService');

beforeEach(() => {
  HeroBriefService.getOrGenerateBrief.mockReset();
  HeroBriefService.getAvailablePhaseTabs.mockReset();

  HeroBriefService.getOrGenerateBrief.mockResolvedValue({
    phase: 'morning',
    headline: 'Morning Brief',
    guidanceText: 'guidance'
  });
  HeroBriefService.getAvailablePhaseTabs.mockResolvedValue([
    { phase: 'morning', label: 'Now' }
  ]);
});

const baseTodayData = {
  totalCalories: 800,
  totalProtein: 60,
  exerciseBurn: 250
};

const baseGoals = {
  dailyCalories: 2000,
  dailyProtein: 150,
  dailyCarbs: 250,
  dailyFats: 65
};

describe('formatHeroSectionWidget — CAL-27 static variant', () => {
  test('static (no dynamicGoal) → goal=dailyCalories, burn=0, dynamic=null', async () => {
    const widget = await AppFormatService.formatHeroSectionWidget(
      'user1', '2026-05-03', { ...baseTodayData },
      baseGoals, 'morning', false, false, null
    );
    expect(widget.widgetType).toBe('hero_section');
    const c = widget.widgetData.calories;
    expect(c.goalType).toBe('static');
    expect(c.goal).toBe(2000);
    expect(c.burn).toBe(0);
    expect(c.consumed).toBe(800);
    expect(c.dynamic).toBeNull();
    expect(c.effectiveTarget).toBeUndefined();
  });

  test('catch-block fallback (HeroBriefService throws) → goalType=static, dynamic=null', async () => {
    HeroBriefService.getOrGenerateBrief.mockRejectedValueOnce(new Error('brief boom'));
    const widget = await AppFormatService.formatHeroSectionWidget(
      'user1', '2026-05-03', { ...baseTodayData },
      baseGoals, 'morning', false, false, null
    );
    const c = widget.widgetData.calories;
    expect(c.goalType).toBe('static');
    expect(c.burn).toBe(0);
    expect(c.dynamic).toBeNull();
    expect(c.goal).toBe(2000);
  });
});

describe('formatHeroSectionWidget — CAL-28 dynamic variant', () => {
  const dynamicGoal = {
    baselineGoal: 1900,
    stepBonus: 60,
    workoutBonus: 90,
    bonusApplied: 150,
    capped: false,
    todaysGoal: 2050,
    breakdown: {
      netSteps: 1200,
      workouts: [
        { kcal_burned: 280, duration_min: 30, bmr_during: 31, net_kcal: 249, contribution: 124.5 }
      ]
    }
  };

  test('dynamic → goal=todaysGoal, burn=0, dynamic block carries full payload', async () => {
    const widget = await AppFormatService.formatHeroSectionWidget(
      'user1', '2026-05-03', { ...baseTodayData },
      baseGoals, 'morning', false, false, dynamicGoal
    );
    const c = widget.widgetData.calories;
    expect(c.goalType).toBe('dynamic');
    expect(c.goal).toBe(2050);
    expect(c.burn).toBe(0);
    expect(c.dynamic).toEqual(dynamicGoal);
  });

  test('dynamic capped day → capped=true preserved on the dynamic sub-object', async () => {
    const capped = { ...dynamicGoal, capped: true, bonusApplied: 950, todaysGoal: 2850 };
    const widget = await AppFormatService.formatHeroSectionWidget(
      'user1', '2026-05-03', { ...baseTodayData },
      baseGoals, 'morning', false, false, capped
    );
    const c = widget.widgetData.calories;
    expect(c.goal).toBe(2850);
    expect(c.dynamic.capped).toBe(true);
    expect(c.dynamic.bonusApplied).toBe(950);
    expect(c.dynamic.todaysGoal).toBe(2850);
  });

  test('dynamic zero-bonus day → todaysGoal===baselineGoal and dynamic block still emitted', async () => {
    const zeroBonus = {
      baselineGoal: 1900,
      stepBonus: 0,
      workoutBonus: 0,
      bonusApplied: 0,
      capped: false,
      todaysGoal: 1900,
      breakdown: { netSteps: 0, workouts: [] }
    };
    const widget = await AppFormatService.formatHeroSectionWidget(
      'user1', '2026-05-03', { ...baseTodayData },
      baseGoals, 'morning', false, false, zeroBonus
    );
    const c = widget.widgetData.calories;
    expect(c.goalType).toBe('dynamic');
    expect(c.goal).toBe(1900);
    expect(c.dynamic.bonusApplied).toBe(0);
    expect(c.dynamic.baselineGoal).toBe(1900);
    expect(c.dynamic.todaysGoal).toBe(1900);
  });
});
