// Tests for goalService.resolveGoalMode (CAL-21).
// Covers each row of the resolution table plus rejected combinations.

const goalService = require('../services/goalService');

describe('goalService.resolveGoalMode', () => {
  describe('happy paths', () => {
    test("mode='static' resolves to all-static + outcome=static_chosen", () => {
      expect(
        goalService.resolveGoalMode({ mode: 'static', calorieTarget: 2000 })
      ).toEqual({
        goalType: 'static',
        intent: 'static',
        outcome: 'static_chosen',
        baselineGoal: 2000,
      });
    });

    test("mode='dynamic' (no override) resolves to all-dynamic", () => {
      expect(
        goalService.resolveGoalMode({ mode: 'dynamic', calorieTarget: 2350 })
      ).toEqual({
        goalType: 'dynamic',
        intent: 'dynamic',
        outcome: 'dynamic',
        baselineGoal: 2350,
      });
    });

    test("mode='dynamic' + permission_denied keeps intent=dynamic, applies static", () => {
      expect(
        goalService.resolveGoalMode({
          mode: 'dynamic',
          outcome: 'static_permission_denied',
          calorieTarget: 1800,
        })
      ).toEqual({
        goalType: 'static',
        intent: 'dynamic',
        outcome: 'static_permission_denied',
        baselineGoal: 1800,
      });
    });

    test("mode='dynamic' + sync_failed keeps intent=dynamic, applies static", () => {
      expect(
        goalService.resolveGoalMode({
          mode: 'dynamic',
          outcome: 'static_sync_failed',
          calorieTarget: 1900,
        })
      ).toEqual({
        goalType: 'static',
        intent: 'dynamic',
        outcome: 'static_sync_failed',
        baselineGoal: 1900,
      });
    });

    test('baselineGoal mirrors calorieTarget across all paths', () => {
      // Smoke check that baselineGoal === input.calorieTarget for each
      // resolved row, regardless of which goalType is applied. This is the
      // PRD §8 invariant that lets a future re-enable-Dynamic prompt fire
      // without forcing a recalculation.
      const target = 2222;
      const cases = [
        { mode: 'static' },
        { mode: 'dynamic' },
        { mode: 'dynamic', outcome: 'static_permission_denied' },
        { mode: 'dynamic', outcome: 'static_sync_failed' },
      ];
      for (const c of cases) {
        const r = goalService.resolveGoalMode({ ...c, calorieTarget: target });
        expect(r.baselineGoal).toBe(target);
      }
    });
  });

  describe('rejected combinations', () => {
    test('missing mode throws', () => {
      expect(() =>
        goalService.resolveGoalMode({ calorieTarget: 2000 })
      ).toThrow(/mode must be/);
    });

    test('invalid mode throws', () => {
      expect(() =>
        goalService.resolveGoalMode({ mode: 'flex', calorieTarget: 2000 })
      ).toThrow(/mode must be/);
    });

    test("mode='static' with any outcome override is rejected", () => {
      expect(() =>
        goalService.resolveGoalMode({
          mode: 'static',
          outcome: 'static_permission_denied',
          calorieTarget: 2000,
        })
      ).toThrow(/only valid when mode='dynamic'/);
    });

    test("mode='dynamic' with outcome='dynamic' is rejected (not a valid override value)", () => {
      // 'dynamic' is the implicit happy-path outcome — clients must omit
      // outcome rather than send it explicitly. Catches a likely client bug.
      expect(() =>
        goalService.resolveGoalMode({
          mode: 'dynamic',
          outcome: 'dynamic',
          calorieTarget: 2000,
        })
      ).toThrow(/outcome override must be/);
    });

    test("mode='dynamic' with outcome='static_chosen' is rejected", () => {
      // static_chosen is reserved for the mode='static' resolution; sending
      // it on mode='dynamic' would silently corrupt the intent invariant.
      expect(() =>
        goalService.resolveGoalMode({
          mode: 'dynamic',
          outcome: 'static_chosen',
          calorieTarget: 2000,
        })
      ).toThrow(/outcome override must be/);
    });

    test("mode='dynamic' with arbitrary string is rejected", () => {
      expect(() =>
        goalService.resolveGoalMode({
          mode: 'dynamic',
          outcome: 'whatever',
          calorieTarget: 2000,
        })
      ).toThrow(/outcome override must be/);
    });
  });
});
