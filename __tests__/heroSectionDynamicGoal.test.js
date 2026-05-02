// CAL-27/28: hero section calories payload shape.
//
// Verifies that formatHeroSectionWidget folds the dynamicGoal block
// into the hero calories payload for dynamic users and emits a clean
// static payload (no `+ burn` additive) for static users.

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
  test('static (no dynamicGoal) → goal=dailyCalories, burn=0, goalType=static', async () => {
    const widget = await AppFormatService.formatHeroSectionWidget(
      'user1', '2026-05-03', { ...baseTodayData },
      baseGoals, 'morning', false, false, null
    );
    expect(widget.widgetType).toBe('hero_section');
    const c = widget.widgetData.calories;
    expect(c.goalType).toBe('static');
    expect(c.goal).toBe(2000);
    expect(c.burn).toBe(0);
    expect(c.effectiveTarget).toBe(2000);
    expect(c.consumed).toBe(800);
    expect(c.baselineGoal).toBeUndefined();
    expect(c.stepBonus).toBeUndefined();
    expect(c.workoutBonus).toBeUndefined();
    expect(c.todaysGoal).toBeUndefined();
    expect(c.breakdown).toBeUndefined();
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

  test('dynamic → goal=todaysGoal, burn=0, breakdown fields present', async () => {
    const widget = await AppFormatService.formatHeroSectionWidget(
      'user1', '2026-05-03', { ...baseTodayData },
      baseGoals, 'morning', false, false, dynamicGoal
    );
    const c = widget.widgetData.calories;
    expect(c.goalType).toBe('dynamic');
    expect(c.goal).toBe(2050);
    expect(c.effectiveTarget).toBe(2050);
    expect(c.burn).toBe(0);
    expect(c.baselineGoal).toBe(1900);
    expect(c.stepBonus).toBe(60);
    expect(c.workoutBonus).toBe(90);
    expect(c.bonusApplied).toBe(150);
    expect(c.capped).toBe(false);
    expect(c.todaysGoal).toBe(2050);
    expect(c.breakdown).toEqual(dynamicGoal.breakdown);
  });

  test('dynamic capped day → capped=true is preserved', async () => {
    const capped = { ...dynamicGoal, capped: true, bonusApplied: 950, todaysGoal: 2850 };
    const widget = await AppFormatService.formatHeroSectionWidget(
      'user1', '2026-05-03', { ...baseTodayData },
      baseGoals, 'morning', false, false, capped
    );
    const c = widget.widgetData.calories;
    expect(c.capped).toBe(true);
    expect(c.bonusApplied).toBe(950);
    expect(c.todaysGoal).toBe(2850);
    expect(c.goal).toBe(2850);
  });
});
