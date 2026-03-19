/**
 * Exercise Database with MET values from the 2011 Compendium of Physical Activities
 * (Ainsworth et al.)
 *
 * MET = Metabolic Equivalent of Task
 * Calories = MET × body weight (kg) × duration (hours)
 *
 * This database matches the frontend exercise catalog (lib/data/exercise_data.dart)
 */

const exercises = {
  // Gym & Fitness (10 exercises)
  'weight_training': {
    exercise_id: 'weight_training',
    name: 'Weight Training',
    category: 'gym_fitness',
    icon: 'fitness_center',
    met_low: 3.5,
    met_moderate: 5.0,
    met_high: 6.0,
    sort_order: 1
  },
  'circuit_training': {
    exercise_id: 'circuit_training',
    name: 'Circuit Training',
    category: 'gym_fitness',
    icon: 'fitness_center',
    met_low: 4.3,
    met_moderate: 5.5,
    met_high: 8.0,
    sort_order: 2
  },
  'stationary_bike': {
    exercise_id: 'stationary_bike',
    name: 'Stationary Bike',
    category: 'gym_fitness',
    icon: 'pedal_bike',
    met_low: 3.5,
    met_moderate: 6.8,
    met_high: 8.8,
    sort_order: 3
  },
  'elliptical': {
    exercise_id: 'elliptical',
    name: 'Elliptical',
    category: 'gym_fitness',
    icon: 'fitness_center',
    met_low: 4.0,
    met_moderate: 5.0,
    met_high: 6.0,
    sort_order: 4
  },
  'treadmill_walking': {
    exercise_id: 'treadmill_walking',
    name: 'Treadmill Walking',
    category: 'gym_fitness',
    icon: 'directions_walk',
    met_low: 3.5,
    met_moderate: 4.3,
    met_high: 5.3,
    sort_order: 5
  },
  'treadmill_running': {
    exercise_id: 'treadmill_running',
    name: 'Treadmill Running',
    category: 'gym_fitness',
    icon: 'directions_run',
    met_low: 8.3,
    met_moderate: 9.8,
    met_high: 11.0,
    sort_order: 6
  },
  'stair_climber': {
    exercise_id: 'stair_climber',
    name: 'Stair Climber',
    category: 'gym_fitness',
    icon: 'stairs',
    met_low: 4.0,
    met_moderate: 6.5,
    met_high: 8.8,
    sort_order: 7
  },
  'rowing_machine': {
    exercise_id: 'rowing_machine',
    name: 'Rowing Machine',
    category: 'gym_fitness',
    icon: 'rowing',
    met_low: 4.8,
    met_moderate: 7.0,
    met_high: 8.5,
    sort_order: 8
  },
  'rope_skipping': {
    exercise_id: 'rope_skipping',
    name: 'Rope Skipping',
    category: 'gym_fitness',
    icon: 'fitness_center',
    met_low: 8.8,
    met_moderate: 11.8,
    met_high: 12.3,
    sort_order: 9
  },
  'stretching': {
    exercise_id: 'stretching',
    name: 'Stretching',
    category: 'gym_fitness',
    icon: 'self_improvement',
    met_low: 2.3,
    met_moderate: 2.5,
    met_high: 3.0,
    sort_order: 10
  },

  // Running & Walking (5 exercises)
  'walking_outdoors': {
    exercise_id: 'walking_outdoors',
    name: 'Walking (Outdoors)',
    category: 'running_walking',
    icon: 'directions_walk',
    met_low: 2.8,
    met_moderate: 3.5,
    met_high: 5.0,
    sort_order: 1
  },
  'running_outdoors': {
    exercise_id: 'running_outdoors',
    name: 'Running (Outdoors)',
    category: 'running_walking',
    icon: 'directions_run',
    met_low: 8.3,
    met_moderate: 9.8,
    met_high: 11.5,
    sort_order: 2
  },
  'jogging': {
    exercise_id: 'jogging',
    name: 'Jogging',
    category: 'running_walking',
    icon: 'directions_run',
    met_low: 6.0,
    met_moderate: 7.0,
    met_high: 8.0,
    sort_order: 3
  },
  'hiking': {
    exercise_id: 'hiking',
    name: 'Hiking',
    category: 'running_walking',
    icon: 'hiking',
    met_low: 5.3,
    met_moderate: 6.0,
    met_high: 7.8,
    sort_order: 4
  },
  'stair_climbing': {
    exercise_id: 'stair_climbing',
    name: 'Stair Climbing',
    category: 'running_walking',
    icon: 'stairs',
    met_low: 4.0,
    met_moderate: 8.0,
    met_high: 8.8,
    sort_order: 5
  },

  // Yoga & Flexibility (3 exercises)
  'yoga_hatha': {
    exercise_id: 'yoga_hatha',
    name: 'Yoga (Hatha/Gentle)',
    category: 'yoga_flexibility',
    icon: 'self_improvement',
    met_low: 2.0,
    met_moderate: 2.5,
    met_high: 3.3,
    sort_order: 1
  },
  'yoga_power': {
    exercise_id: 'yoga_power',
    name: 'Yoga (Power/Vinyasa)',
    category: 'yoga_flexibility',
    icon: 'self_improvement',
    met_low: 3.3,
    met_moderate: 4.0,
    met_high: 5.0,
    sort_order: 2
  },
  'pilates': {
    exercise_id: 'pilates',
    name: 'Pilates',
    category: 'yoga_flexibility',
    icon: 'self_improvement',
    met_low: 2.5,
    met_moderate: 3.0,
    met_high: 4.0,
    sort_order: 3
  },

  // Sports (9 exercises)
  'cricket': {
    exercise_id: 'cricket',
    name: 'Cricket',
    category: 'sports',
    icon: 'sports_cricket',
    met_low: 4.0,
    met_moderate: 6.8,
    met_high: 10.0,
    sort_order: 1
  },
  'badminton': {
    exercise_id: 'badminton',
    name: 'Badminton',
    category: 'sports',
    icon: 'sports_tennis',
    met_low: 4.5,
    met_moderate: 5.5,
    met_high: 7.0,
    sort_order: 2
  },
  'football': {
    exercise_id: 'football',
    name: 'Football/Soccer',
    category: 'sports',
    icon: 'sports_soccer',
    met_low: 5.0,
    met_moderate: 7.0,
    met_high: 10.0,
    sort_order: 3
  },
  'tennis': {
    exercise_id: 'tennis',
    name: 'Tennis',
    category: 'sports',
    icon: 'sports_tennis',
    met_low: 4.5,
    met_moderate: 5.0,
    met_high: 8.0,
    sort_order: 4
  },
  'table_tennis': {
    exercise_id: 'table_tennis',
    name: 'Table Tennis',
    category: 'sports',
    icon: 'sports_tennis',
    met_low: 3.0,
    met_moderate: 4.0,
    met_high: 5.0,
    sort_order: 5
  },
  'volleyball': {
    exercise_id: 'volleyball',
    name: 'Volleyball',
    category: 'sports',
    icon: 'sports_volleyball',
    met_low: 3.0,
    met_moderate: 4.0,
    met_high: 6.0,
    sort_order: 6
  },
  'basketball': {
    exercise_id: 'basketball',
    name: 'Basketball',
    category: 'sports',
    icon: 'sports_basketball',
    met_low: 4.5,
    met_moderate: 6.0,
    met_high: 8.0,
    sort_order: 7
  },
  'kabaddi': {
    exercise_id: 'kabaddi',
    name: 'Kabaddi',
    category: 'sports',
    icon: 'sports_martial_arts',
    met_low: 5.0,
    met_moderate: 7.0,
    met_high: 10.0,
    sort_order: 8
  },
  'kho_kho': {
    exercise_id: 'kho_kho',
    name: 'Kho Kho',
    category: 'sports',
    icon: 'sports_martial_arts',
    met_low: 4.0,
    met_moderate: 6.0,
    met_high: 8.0,
    sort_order: 9
  },

  // Cycling (1 exercise)
  'cycling_outdoor': {
    exercise_id: 'cycling_outdoor',
    name: 'Cycling (Outdoor)',
    category: 'cycling',
    icon: 'pedal_bike',
    met_low: 4.0,
    met_moderate: 6.8,
    met_high: 10.0,
    sort_order: 1
  },

  // Swimming & Water (3 exercises)
  'swimming_freestyle': {
    exercise_id: 'swimming_freestyle',
    name: 'Swimming (Freestyle)',
    category: 'swimming_water',
    icon: 'pool',
    met_low: 5.8,
    met_moderate: 8.3,
    met_high: 9.8,
    sort_order: 1
  },
  'swimming_general': {
    exercise_id: 'swimming_general',
    name: 'Swimming (General)',
    category: 'swimming_water',
    icon: 'pool',
    met_low: 4.8,
    met_moderate: 6.0,
    met_high: 8.0,
    sort_order: 2
  },
  'water_aerobics': {
    exercise_id: 'water_aerobics',
    name: 'Water Aerobics',
    category: 'swimming_water',
    icon: 'pool',
    met_low: 3.5,
    met_moderate: 5.3,
    met_high: 5.5,
    sort_order: 3
  },

  // Dance (3 exercises)
  'dance_general': {
    exercise_id: 'dance_general',
    name: 'Dance (General)',
    category: 'dance',
    icon: 'music_note',
    met_low: 3.0,
    met_moderate: 5.0,
    met_high: 7.3,
    sort_order: 1
  },
  'dance_indian': {
    exercise_id: 'dance_indian',
    name: 'Dance (Indian/Cultural)',
    category: 'dance',
    icon: 'music_note',
    met_low: 3.5,
    met_moderate: 4.5,
    met_high: 6.0,
    sort_order: 2
  },
  'zumba': {
    exercise_id: 'zumba',
    name: 'Zumba/Aerobics',
    category: 'dance',
    icon: 'music_note',
    met_low: 5.0,
    met_moderate: 7.3,
    met_high: 9.5,
    sort_order: 3
  },

  // Martial Arts (2 exercises)
  'martial_arts': {
    exercise_id: 'martial_arts',
    name: 'Martial Arts',
    category: 'martial_arts',
    icon: 'sports_martial_arts',
    met_low: 5.3,
    met_moderate: 10.3,
    met_high: 12.0,
    sort_order: 1
  },
  'boxing': {
    exercise_id: 'boxing',
    name: 'Boxing',
    category: 'martial_arts',
    icon: 'sports_mma',
    met_low: 5.5,
    met_moderate: 7.8,
    met_high: 12.8,
    sort_order: 2
  }
};

/**
 * Get exercise by ID
 * @param {string} exerciseId - Exercise ID
 * @returns {Object|null} Exercise object or null if not found
 */
function getExercise(exerciseId) {
  return exercises[exerciseId] || null;
}

/**
 * Get MET value for an exercise at a specific intensity
 * @param {string} exerciseId - Exercise ID
 * @param {string} intensity - 'low', 'moderate', or 'high'
 * @returns {number|null} MET value or null if not found
 */
function getMetValue(exerciseId, intensity) {
  const exercise = exercises[exerciseId];
  if (!exercise) return null;

  const intensityKey = `met_${intensity}`;
  return exercise[intensityKey] || null;
}

/**
 * Get all exercises as an array
 * @returns {Array} Array of all exercises
 */
function getAllExercises() {
  return Object.values(exercises);
}

module.exports = {
  exercises,
  getExercise,
  getMetValue,
  getAllExercises
};
