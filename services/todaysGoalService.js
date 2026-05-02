// CAL-23: Daily flex orchestrator. Reads today's activity from
// ActivityStore, plugs it into goalService.computeTodaysGoal, and returns
// the dynamicGoal payload that /app/progress surfaces alongside the
// legacy macros block. Returns null for users on the static variant or
// users missing the cached RMR / baselineGoal (e.g. dynamic users who
// haven't re-saved goals since the CAL-23 rollout).

const ActivityStoreService = require('./activityStoreService');
const goalService = require('./goalService');
const mongoose = require('mongoose');

// Sums STEPS values across all SUMMARY docs for the day (one doc per
// source). Mirrors exerciseBurnWidgetService.extractSteps — same caveat
// that summing across multiple connected sources (Apple + Google) can
// double-count; not in scope to fix here.
function sumDailySteps(summaryDocs) {
  let total = 0;
  for (const doc of summaryDocs || []) {
    for (const item of doc.data || []) {
      const type = item.activity_type != null ? String(item.activity_type).toUpperCase() : '';
      if (type !== 'STEPS') continue;
      const value = typeof item.value === 'number' ? item.value : parseFloat(item.value);
      if (Number.isFinite(value)) total += value;
    }
  }
  return Math.max(0, Math.round(total));
}

// Flattens EXERCISE docs into the {calories_burned, duration_min} shape
// computeTodaysGoal expects. ActivityStore EXERCISE items are already
// deduped at write time by start_time|end_time (see
// utils/activityStoreUtils.js), so manual workouts (which exerciseService
// writes through to ActivityStore with source='manual') flow through this
// same path with no source-specific branching.
//
// Calorie field fallback mirrors exerciseBurnWidgetService.buildWorkoutEntry
// so the home tile's `workoutBonus` and the burn widget's displayed kcal
// agree on the same number — different fallback chains here would silently
// drop HealthKit-sourced workouts (which populate active_calories /
// total_calories instead of calories_burned) and surface as workoutBonus=0
// despite a visible workout in the burn widget.
function flattenWorkouts(exerciseDocs) {
  const workouts = [];
  for (const doc of exerciseDocs || []) {
    for (const item of doc.data || []) {
      const calories_burned = Number.isFinite(item.calories_burned)
        ? item.calories_burned
        : Number.isFinite(item.active_calories)
          ? item.active_calories
          : Number.isFinite(item.total_calories)
            ? item.total_calories
            : 0;
      const duration_min = Number.isFinite(item.duration_min)
        ? item.duration_min
        : (Number.isFinite(item.start_time) && Number.isFinite(item.end_time)
            ? Math.max(0, (item.end_time - item.start_time) / 60000)
            : 0);
      workouts.push({ calories_burned, duration_min });
    }
  }
  return workouts;
}

/**
 * Build the dynamicGoal payload for /app/progress.
 *
 * @param {Object} user - Already-loaded User document (lean or hydrated).
 *   Caller is expected to have fetched this — re-querying here would
 *   double the User.findById on a hot endpoint.
 * @param {string} istDateStr - YYYY-MM-DD in IST. Caller should pass
 *   today; passing a past date is supported but ActivityStore is only
 *   mutable for today, so it'll just reflect a frozen snapshot.
 * @returns {Promise<Object|null>} dynamicGoal block, or null if the user
 *   is not on the dynamic variant or required cached fields are missing.
 */
async function buildTodaysGoal(user, istDateStr) {
  if (!user || !user._id) return null;

  const goals = user.goals || {};
  if (goals.goalType !== 'dynamic') return null;
  if (!Number.isFinite(goals.baselineGoal) || goals.baselineGoal <= 0) return null;
  if (!Number.isFinite(goals.rmr) || goals.rmr <= 0) return null;

  const userIdObjectId = typeof user._id === 'string'
    ? new mongoose.Types.ObjectId(user._id)
    : user._id;

  const [summaryDocs, exerciseDocs] = await Promise.all([
    ActivityStoreService.fetch(userIdObjectId, istDateStr, { category: 'SUMMARY' }),
    ActivityStoreService.fetch(userIdObjectId, istDateStr, { category: 'EXERCISE' })
  ]);

  const netSteps = sumDailySteps(summaryDocs);
  const workouts = flattenWorkouts(exerciseDocs);

  const result = goalService.computeTodaysGoal({
    baselineGoal: goals.baselineGoal,
    netSteps,
    workouts,
    rmrPerDay: goals.rmr
  });

  return {
    baselineGoal: goals.baselineGoal,
    stepBonus: result.stepBonus,
    workoutBonus: result.workoutBonus,
    bonusApplied: result.bonusApplied,
    capped: result.capped,
    todaysGoal: result.todaysGoal,
    breakdown: result.breakdown
  };
}

/**
 * CAL-44: Per-day macro split for dynamic users.
 *
 * Synchronous — the recipe coefficients live on user.goals (already
 * hydrated by the caller), so no DB read here. Mirrors buildTodaysGoal's
 * "null on static / null on missing fields" contract: the format layer
 * (formatHeroSectionWidget / formatMacroWidget / getProgressData) treats
 * a null return as "fall back to flat persisted dailyProtein/Fats/Carbs,"
 * so existing dynamic users who haven't re-saved goals post-CAL-44 keep
 * working — they just don't see daily-scaled macros until they re-save.
 *
 * @param {Object} user - Already-loaded User document. Caller is expected
 *   to have fetched this; mirrors buildTodaysGoal's contract.
 * @param {number} todaysGoal - The day's calorie ceiling. Pass
 *   dynamicGoal.todaysGoal from buildTodaysGoal.
 * @returns {Object|null} {protein, fat, carbs} where each is
 *   {goal_g, goal_kcal}, or null if user is static / missing recipe /
 *   missing weightKg / todaysGoal invalid.
 */
function buildTodaysMacros(user, todaysGoal) {
  if (!user) return null;
  const goals = user.goals || {};
  if (goals.goalType !== 'dynamic') return null;
  if (!Number.isFinite(goals.weightKg) || goals.weightKg <= 0) return null;
  if (!Number.isFinite(goals.proteinGramsPerKg) || goals.proteinGramsPerKg <= 0) return null;
  if (!Number.isFinite(goals.fatPctFloor) || goals.fatPctFloor <= 0) return null;
  if (!Number.isFinite(todaysGoal) || todaysGoal <= 0) return null;

  // fatGramsPerKgFloor has a schema default, but for legacy users
  // persisted before the default landed (or any gap), fall back to the
  // service-level constant — keeps the math independent of schema
  // migration timing.
  const fatGFloor = Number.isFinite(goals.fatGramsPerKgFloor) && goals.fatGramsPerKgFloor >= 0
    ? goals.fatGramsPerKgFloor
    : goalService.DEFAULT_FAT_G_PER_KG_FLOOR;

  const macros = goalService.computeTodaysMacros({
    todaysGoal,
    weight_kg: goals.weightKg,
    protein_factor: goals.proteinGramsPerKg,
    fat_pct_floor: goals.fatPctFloor,
    fat_g_per_kg_floor: fatGFloor
  });

  if (!macros) return null;

  return {
    protein: { goal_g: macros.protein_g, goal_kcal: macros.protein_kcal },
    fat:     { goal_g: macros.fat_g,     goal_kcal: macros.fat_kcal },
    carbs:   { goal_g: macros.carb_g,    goal_kcal: macros.carb_kcal }
  };
}

module.exports = {
  buildTodaysGoal,
  buildTodaysMacros,
  // exported for unit testing
  sumDailySteps,
  flattenWorkouts
};
