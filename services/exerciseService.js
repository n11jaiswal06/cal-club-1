const mongoose = require('mongoose');
const ExerciseLog = require('../models/schemas/ExerciseLog');
const UserLog = require('../models/schemas/UserLog');
const ActivityStore = require('../models/schemas/ActivityStore');
const { getExercise, getMetValue } = require('../data/exerciseDatabase');
const ActivityStoreService = require('./activityStoreService');
const { resolveDate } = require('../utils/dateUtils');
const { buildId } = require('../utils/activityStoreUtils');

const DEFAULT_WEIGHT_KG = 70;

async function getLatestWeightKg(userId) {
  const uid = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
  const latest = await UserLog.findOne({ userId: uid, type: 'WEIGHT' }).sort({ date: -1 }).lean();
  const parsed = latest?.value != null ? parseFloat(latest.value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WEIGHT_KG;
}

class ExerciseService {
  /**
   * Log a new exercise for a user
   * @param {ObjectId|string} userId - User ID
   * @param {string} exerciseId - Exercise ID from exercise database
   * @param {string} intensity - 'low', 'moderate', or 'high'
   * @param {number} durationMin - Duration in minutes
   * @param {string} loggedForDate - Date in YYYY-MM-DD format
   * @returns {Promise<Object>} Created exercise log
   */
  static async logExercise(userId, exerciseId, intensity, durationMin, loggedForDate) {
    // Validate inputs
    if (!exerciseId || !intensity || !durationMin || !loggedForDate) {
      throw new Error('Missing required fields: exercise_id, intensity, duration_min, logged_for_date');
    }

    if (!['low', 'moderate', 'high'].includes(intensity)) {
      throw new Error('Invalid intensity. Must be low, moderate, or high');
    }

    if (durationMin < 1) {
      throw new Error('Duration must be at least 1 minute');
    }

    // Get exercise from database
    const exercise = getExercise(exerciseId);
    if (!exercise) {
      throw new Error(`Exercise not found: ${exerciseId}`);
    }

    // Get MET value for the specified intensity
    const metValue = getMetValue(exerciseId, intensity);
    if (!metValue) {
      throw new Error(`MET value not found for exercise ${exerciseId} at intensity ${intensity}`);
    }

    // Weight comes from user_logs (type: WEIGHT, latest entry).
    // Falls back to 70kg when the user has never logged weight — keeps
    // manual logging usable during the onboarding edge case rather than
    // rejecting the log and surfacing a confusing error.
    const userWeightKg = await getLatestWeightKg(userId);

    // Formula: calories = MET × weight_kg × (duration_min / 60)
    const caloriesBurned = Math.round(metValue * userWeightKg * (durationMin / 60));

    // Create exercise log
    const log = await ExerciseLog.create({
      user_id: userId,
      exercise_id: exerciseId,
      exercise_name: exercise.name,
      exercise_icon: exercise.icon,
      intensity,
      duration_min: durationMin,
      met_value: metValue,
      calories_burned: caloriesBurned,
      user_weight_kg: userWeightKg,
      source: 'manual',
      logged_for_date: resolveDate(loggedForDate)
    });

    // Sync to ActivityStore
    await this.syncToActivityStore(userId, log);

    return log;
  }

  /**
   * Sync an exercise log to the ActivityStore
   * @param {ObjectId|string} userId - User ID
   * @param {Object} log - Exercise log object
   * @private
   */
  static async syncToActivityStore(userId, log) {
    const activityData = [{
      activity_type: 'EXERCISE',
      exercise_id: log.exercise_id,
      exercise_name: log.exercise_name,
      exercise_icon: log.exercise_icon,
      intensity: log.intensity,
      duration_min: log.duration_min,
      calories_burned: log.calories_burned,
      met_value: log.met_value,
      start_time: log.createdAt.getTime(),
      end_time: log.createdAt.getTime() + (log.duration_min * 60000),
      log_id: log._id.toString(), // Link back to ExerciseLog for traceability
      source: 'manual'
    }];

    await ActivityStoreService.sync(userId, 'MANUAL', [{
      date: log.logged_for_date,
      data: activityData
    }]);
  }

  /**
   * Get all exercise logs for a user on a specific date
   * @param {ObjectId|string} userId - User ID
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<Array>} Array of exercise logs
   */
  static async getExerciseLogs(userId, date) {
    const dateStr = resolveDate(date);
    return await ExerciseLog.find({
      user_id: userId,
      logged_for_date: dateStr
    }).sort({ createdAt: -1 }).lean();
  }

  /**
   * Get total calories burned for a user on a specific date
   * @param {ObjectId|string} userId - User ID
   * @param {string} date - Date in YYYY-MM-DD format
   * @returns {Promise<number>} Total calories burned
   */
  static async getTotalCaloriesBurned(userId, date) {
    const dateStr = resolveDate(date);
    const logs = await ExerciseLog.find({
      user_id: userId,
      logged_for_date: dateStr
    }).lean();

    return logs.reduce((sum, log) => sum + (log.calories_burned || 0), 0);
  }

  /**
   * Delete an exercise log
   * @param {ObjectId|string} userId - User ID
   * @param {string} logId - Exercise log ID
   * @returns {Promise<void>}
   */
  static async deleteExerciseLog(userId, logId) {
    const log = await ExerciseLog.findOne({ _id: logId, user_id: userId });
    if (!log) {
      throw new Error('Exercise log not found');
    }

    const loggedForDate = log.logged_for_date;
    await ExerciseLog.deleteOne({ _id: logId, user_id: userId });

    // Pull the item out of the ActivityStore doc directly. We cannot round-trip
    // through ActivityStoreService.sync() because the EXERCISE merge rule
    // appends-and-dedupes by (start_time|end_time) — re-syncing the remaining
    // logs would leave the removed entry in place. Also bypasses the
    // past-day-immutable guard on purpose: user-initiated deletes of manual
    // logs override the guard, which only exists to protect health-sync data.
    const activityStoreId = buildId(userId, 'EXERCISE', 'MANUAL', loggedForDate);
    await ActivityStore.findByIdAndUpdate(
      activityStoreId,
      { $pull: { data: { log_id: logId.toString() } } }
    );
  }

  /**
   * Get recent exercises for a user (last 5 unique exercise+intensity combinations)
   * @param {ObjectId|string} userId - User ID
   * @param {number} limit - Maximum number of recent exercises to return
   * @returns {Promise<Array>} Array of recent exercises
   */
  static async getRecentExercises(userId, limit = 5) {
    const logs = await ExerciseLog.find({ user_id: userId })
      .sort({ createdAt: -1 })
      .limit(limit * 3) // Get more than needed to filter duplicates
      .lean();

    // Remove duplicates based on exercise_id + intensity combination
    const seen = new Set();
    const uniqueLogs = [];

    for (const log of logs) {
      const key = `${log.exercise_id}_${log.intensity}`;
      if (!seen.has(key) && uniqueLogs.length < limit) {
        seen.add(key);
        uniqueLogs.push({
          exercise_id: log.exercise_id,
          exercise_name: log.exercise_name,
          intensity: log.intensity
        });
      }
    }

    return uniqueLogs;
  }
}

module.exports = ExerciseService;
