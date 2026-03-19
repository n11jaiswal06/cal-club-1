const ExerciseLog = require('../models/schemas/ExerciseLog');
const User = require('../models/schemas/User');
const { getExercise, getMetValue } = require('../data/exerciseDatabase');
const ActivityStoreService = require('./activityStoreService');
const { resolveDate } = require('../utils/dateUtils');

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

    // Get user's current weight
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const userWeightKg = user.goals?.currentWeight || user.weight || null;
    if (!userWeightKg) {
      throw new Error('User weight not found. Please update your profile with current weight.');
    }

    // Calculate calories burned
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
    // Find the log first
    const log = await ExerciseLog.findOne({ _id: logId, user_id: userId });
    if (!log) {
      throw new Error('Exercise log not found');
    }

    const loggedForDate = log.logged_for_date;

    // Delete from ExerciseLog collection
    await ExerciseLog.deleteOne({ _id: logId, user_id: userId });

    // Re-sync to ActivityStore (without the deleted exercise)
    const remainingLogs = await this.getExerciseLogs(userId, loggedForDate);

    // Build activity data from remaining logs
    const activityData = remainingLogs.map(remainingLog => ({
      activity_type: 'EXERCISE',
      exercise_id: remainingLog.exercise_id,
      exercise_name: remainingLog.exercise_name,
      exercise_icon: remainingLog.exercise_icon,
      intensity: remainingLog.intensity,
      duration_min: remainingLog.duration_min,
      calories_burned: remainingLog.calories_burned,
      met_value: remainingLog.met_value,
      start_time: new Date(remainingLog.createdAt).getTime(),
      end_time: new Date(remainingLog.createdAt).getTime() + (remainingLog.duration_min * 60000),
      log_id: remainingLog._id.toString(),
      source: 'manual'
    }));

    // Sync updated data to ActivityStore
    await ActivityStoreService.sync(userId, 'MANUAL', [{
      date: loggedForDate,
      data: activityData
    }]);
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
