const ExerciseService = require('../services/exerciseService');
const parseBody = require('../utils/parseBody');

// parseBody is callback-based across the rest of the codebase. Wrap it so
// this file can keep async/await — switching every route to callback style
// would be more invasive than this six-line adapter.
function parseBodyAsync(req) {
  return new Promise((resolve, reject) => {
    parseBody(req, (err, data) => (err ? reject(err) : resolve(data)));
  });
}

/**
 * Exercise routes handler
 * Handles API endpoints for exercise logging
 */
async function exerciseRoutes(req, res) {
  const { method, url } = req;
  const userId = req.user?.userId;

  // Check authentication
  if (!userId) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Unauthorized. Please login.' }));
    return;
  }

  try {
    // POST /api/exercise-log - Log a new exercise
    if (method === 'POST' && url === '/api/exercise-log') {
      const body = await parseBodyAsync(req);
      const { exercise_id, intensity, duration_min, logged_for_date } = body;

      const log = await ExerciseService.logExercise(
        userId,
        exercise_id,
        intensity,
        duration_min,
        logged_for_date
      );

      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        log: {
          log_id: log._id.toString(),
          exercise_id: log.exercise_id,
          exercise_name: log.exercise_name,
          exercise_icon: log.exercise_icon,
          intensity: log.intensity,
          duration_min: log.duration_min,
          calories_burned: log.calories_burned,
          met_value: log.met_value,
          user_weight_kg: log.user_weight_kg,
          source: log.source,
          logged_for_date: log.logged_for_date,
          created_at: log.createdAt,
          updated_at: log.updatedAt
        }
      }));
      return;
    }

    // GET /api/exercise-log?date=YYYY-MM-DD - Get logs for a date
    if (method === 'GET' && url.startsWith('/api/exercise-log')) {
      const urlObj = new URL(url, `http://${req.headers.host}`);
      const date = urlObj.searchParams.get('date');

      if (!date) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing required query parameter: date' }));
        return;
      }

      const logs = await ExerciseService.getExerciseLogs(userId, date);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        logs: logs.map(log => ({
          log_id: log._id.toString(),
          exercise_id: log.exercise_id,
          exercise_name: log.exercise_name,
          exercise_icon: log.exercise_icon,
          intensity: log.intensity,
          duration_min: log.duration_min,
          calories_burned: log.calories_burned,
          met_value: log.met_value,
          user_weight_kg: log.user_weight_kg,
          source: log.source,
          logged_for_date: log.logged_for_date,
          created_at: log.createdAt,
          updated_at: log.updatedAt
        }))
      }));
      return;
    }

    // DELETE /api/exercise-log/:logId - Delete an exercise log
    if (method === 'DELETE' && url.startsWith('/api/exercise-log/')) {
      const logId = url.split('/api/exercise-log/')[1];

      if (!logId) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Missing log ID' }));
        return;
      }

      await ExerciseService.deleteExerciseLog(userId, logId);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, message: 'Exercise log deleted successfully' }));
      return;
    }

    // GET /api/exercises/recent - Get recent exercises
    if (method === 'GET' && url === '/api/exercises/recent') {
      const recent = await ExerciseService.getRecentExercises(userId);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        recent
      }));
      return;
    }

    // Route not found
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Route not found' }));

  } catch (error) {
    console.error('Exercise route error:', error);
    res.statusCode = error.message.includes('not found') ? 404 : 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: error.message || 'Internal server error'
    }));
  }
}

module.exports = exerciseRoutes;
