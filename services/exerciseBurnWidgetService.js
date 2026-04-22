const ActivityStoreService = require('./activityStoreService');
const UserLog = require('../models/schemas/UserLog');
const mongoose = require('mongoose');

// Physiological conversion for walking. ~0.00057 kcal/step/kg is standard
// for a moderate pace; scaled by the user's current weight.
const STEP_KCAL_PER_KG = 0.00057;

// Used when a user has never logged a weight (pre-onboarding edge case).
const DEFAULT_WEIGHT_KG = 70;

const WORKOUT_TYPE_LABELS = {
  RUNNING: 'Running',
  WALKING: 'Walking',
  BIKING: 'Cycling',
  CYCLING: 'Cycling',
  SWIMMING: 'Swimming',
  HIKING: 'Hiking',
  YOGA: 'Yoga',
  PILATES: 'Pilates',
  STRENGTH_TRAINING: 'Strength training',
  TRADITIONAL_STRENGTH_TRAINING: 'Strength training',
  FUNCTIONAL_STRENGTH_TRAINING: 'Strength training',
  HIGH_INTENSITY_INTERVAL_TRAINING: 'HIIT',
  ELLIPTICAL: 'Elliptical',
  ROWING: 'Rowing',
  DANCE: 'Dance',
  CROSS_TRAINING: 'Cross training',
  CORE_TRAINING: 'Core training',
};

const SOURCE_DISPLAY = {
  apple_health: 'Apple Health',
  google_health_connect: 'Google Fit',
  manual: 'Manual',
};

function humaniseExerciseType(type) {
  if (!type) return 'Exercise';
  const key = String(type).toUpperCase();
  if (WORKOUT_TYPE_LABELS[key]) return WORKOUT_TYPE_LABELS[key];
  return key
    .toLowerCase()
    .split('_')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function sourceDisplayName(source) {
  return SOURCE_DISPLAY[source] || source;
}

async function getLatestWeightKg(userId) {
  const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const latest = await UserLog.findOne({ userId: uid, type: 'WEIGHT' }).sort({ date: -1 }).lean();
  const parsed = latest?.value != null ? parseFloat(latest.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WEIGHT_KG;
}

function extractSteps(summaryDocs) {
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

function buildStepsEntry(steps, weightKg) {
  const kcal = Math.round(steps * weightKg * STEP_KCAL_PER_KG);
  const stepsLabel = steps.toLocaleString('en-IN');
  return {
    exerciseId: 'daily_steps',
    exercise_name: 'Daily Steps',
    subtitle: steps > 0 ? `${stepsLabel} steps today` : 'No steps yet today',
    calories: kcal,
    is_steps: true,
    source: 'steps',
  };
}

function buildWorkoutEntry(item, sourceLower) {
  const name = humaniseExerciseType(item.exercise_type || item.exercise_name);
  const duration = Number.isFinite(item.duration_min)
    ? item.duration_min
    : (item.start_time && item.end_time
        ? Math.max(0, Math.round((item.end_time - item.start_time) / 60000))
        : 0);
  const sourceLabel = sourceDisplayName(sourceLower);
  const subtitleParts = [];
  if (sourceLabel) subtitleParts.push(sourceLabel);
  if (duration > 0) subtitleParts.push(`${duration} min`);

  const active = Number.isFinite(item.active_calories) ? item.active_calories : null;
  const total = Number.isFinite(item.total_calories) ? item.total_calories : null;
  const logCalories = Number.isFinite(item.calories_burned) ? item.calories_burned : null;
  const calories = Math.max(0, Math.round(logCalories ?? active ?? total ?? 0));

  const id = item.log_id
    ? String(item.log_id)
    : `${sourceLower}_${item.start_time || ''}_${item.end_time || ''}`;

  return {
    exerciseId: id,
    exercise_name: item.exercise_name || name,
    subtitle: subtitleParts.join(' · '),
    calories,
    is_steps: false,
    source: sourceLower,
  };
}

// Computes both the widget payload and the total kcal burned for a day.
// Same data source feeds two surfaces: the exercise_burn_widget and the
// hero section's calorie progress bar (goal + burn = effective target).
async function buildExerciseBurnContext(userId, dateStr) {
  const [exerciseDocs, summaryDocs, weightKg] = await Promise.all([
    ActivityStoreService.fetch(userId, dateStr, { category: 'EXERCISE' }),
    ActivityStoreService.fetch(userId, dateStr, { category: 'SUMMARY' }),
    getLatestWeightKg(userId),
  ]);

  const steps = extractSteps(summaryDocs);
  const stepsEntry = buildStepsEntry(steps, weightKg);

  const workouts = [];
  for (const doc of exerciseDocs || []) {
    const sourceLower = String(doc.source || '').toLowerCase();
    for (const item of doc.data || []) {
      workouts.push(buildWorkoutEntry(item, sourceLower));
    }
  }
  workouts.sort((a, b) => b.calories - a.calories);

  const exercises = [stepsEntry, ...workouts];
  const totalCalories = exercises.reduce((sum, e) => sum + (e.calories || 0), 0);

  const widget = {
    widgetType: 'exercise_burn_widget',
    widgetData: {
      title: 'Exercise burn',
      subtitle: `${totalCalories} kcal burned today`,
      exercises,
    },
  };

  return { widget, totalCalories };
}

async function formatExerciseBurnWidget(userId, dateStr) {
  const { widget } = await buildExerciseBurnContext(userId, dateStr);
  return widget;
}

module.exports = {
  buildExerciseBurnContext,
  formatExerciseBurnWidget,
};
