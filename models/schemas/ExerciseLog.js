const mongoose = require('mongoose');

const exerciseLogSchema = new mongoose.Schema({
  user_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  exercise_id: {
    type: String,
    required: true
  },
  exercise_name: {
    type: String,
    required: true
  },
  exercise_icon: {
    type: String,
    default: 'fitness_center'
  },
  intensity: {
    type: String,
    enum: ['low', 'moderate', 'high'],
    required: true
  },
  duration_min: {
    type: Number,
    required: true,
    min: 1
  },
  met_value: {
    type: Number,
    required: true
  },
  calories_burned: {
    type: Number,
    required: true
  },
  user_weight_kg: {
    type: Number,
    required: true
  },
  source: {
    type: String,
    enum: ['manual', 'apple_health', 'google_health'],
    default: 'manual'
  },
  logged_for_date: {
    type: String, // YYYY-MM-DD format
    required: true,
    index: true
  }
}, {
  timestamps: true // Adds createdAt and updatedAt
});

// Compound index for efficient date-based queries
exerciseLogSchema.index({ user_id: 1, logged_for_date: 1 });

// Index for recent logs
exerciseLogSchema.index({ user_id: 1, createdAt: -1 });

const ExerciseLog = mongoose.model('ExerciseLog', exerciseLogSchema);

module.exports = ExerciseLog;
