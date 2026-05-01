// Tests for goalService.resolveGoalMode (CAL-21, updated by CAL-22).
//
// CAL-22 changed the baselineGoal semantics:
//   • mode='static' resolutions still take baselineGoal from calorieTarget
//     (the v2 result with NEAT) — documentational, nothing reads it.
//   • mode='dynamic' resolutions (including permission-denied fallbacks)
//     now take baselineGoal from the new dynamicBaseline param (BMR×1.2 ±
//     delta, floored). CAL-23's daily-flex math adds activity bonus on top
//     of baselineGoal, so it must be the bonus-free dynamic baseline to
//     avoid double-counting.

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

    test("mode='dynamic' (no override) resolves to all-dynamic with dynamicBaseline as baselineGoal", () => {
      expect(
        goalService.resolveGoalMode({
          mode: 'dynamic',
          calorieTarget: 2350,
          dynamicBaseline: 1900,
        })
      ).toEqual({
        goalType: 'dynamic',
        intent: 'dynamic',
        outcome: 'dynamic',
        baselineGoal: 1900,
      });
    });

    test("mode='dynamic' + permission_denied keeps intent=dynamic, baselineGoal=dynamicBaseline", () => {
      expect(
        goalService.resolveGoalMode({
          mode: 'dynamic',
          outcome: 'static_permission_denied',
          calorieTarget: 1800,
          dynamicBaseline: 1500,
        })
      ).toEqual({
        goalType: 'static',
        intent: 'dynamic',
        outcome: 'static_permission_denied',
        baselineGoal: 1500,
      });
    });

    test("mode='dynamic' + sync_failed keeps intent=dynamic, baselineGoal=dynamicBaseline", () => {
      expect(
        goalService.resolveGoalMode({
          mode: 'dynamic',
          outcome: 'static_sync_failed',
          calorieTarget: 1900,
          dynamicBaseline: 1620,
        })
      ).toEqual({
        goalType: 'static',
        intent: 'dynamic',
        outcome: 'static_sync_failed',
        baselineGoal: 1620,
      });
    });

    test("baselineGoal source is mode-dependent: static→calorieTarget, dynamic→dynamicBaseline", () => {
      // Distinct numbers so we can prove which source each branch uses.
      const calorieTarget = 2222;
      const dynamicBaseline = 1295;

      expect(
        goalService.resolveGoalMode({ mode: 'static', calorieTarget }).baselineGoal
      ).toBe(calorieTarget);

      const dynamicCases = [
        { mode: 'dynamic' },
        { mode: 'dynamic', outcome: 'static_permission_denied' },
        { mode: 'dynamic', outcome: 'static_sync_failed' },
      ];
      for (const c of dynamicCases) {
        const r = goalService.resolveGoalMode({ ...c, calorieTarget, dynamicBaseline });
        expect(r.baselineGoal).toBe(dynamicBaseline);
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

    test("mode='dynamic' without dynamicBaseline throws (CAL-22)", () => {
      // dynamicBaseline is mandatory on the dynamic path now — protects
      // against silently persisting an undefined baselineGoal that would
      // break CAL-23's daily-flex math.
      expect(() =>
        goalService.resolveGoalMode({ mode: 'dynamic', calorieTarget: 2000 })
      ).toThrow(/dynamicBaseline is required/);
    });

    test("mode='dynamic' with outcome='dynamic' is rejected (not a valid override value)", () => {
      // 'dynamic' is the implicit happy-path outcome — clients must omit
      // outcome rather than send it explicitly. Catches a likely client bug.
      expect(() =>
        goalService.resolveGoalMode({
          mode: 'dynamic',
          outcome: 'dynamic',
          calorieTarget: 2000,
          dynamicBaseline: 1500,
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
          dynamicBaseline: 1500,
        })
      ).toThrow(/outcome override must be/);
    });

    test("mode='dynamic' with arbitrary string is rejected", () => {
      expect(() =>
        goalService.resolveGoalMode({
          mode: 'dynamic',
          outcome: 'whatever',
          calorieTarget: 2000,
          dynamicBaseline: 1500,
        })
      ).toThrow(/outcome override must be/);
    });
  });
});
