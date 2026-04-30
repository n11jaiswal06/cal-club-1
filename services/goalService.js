/**
 * Goal Calculation Service
 * Implements Mifflin-St Jeor RMR, TDEE calculation, and macro distribution
 */

class GoalService {
  constructor() {
    // Constants
    this.PRO_G_PER_KG = 1.8;           // g protein per kg body weight
    this.FAT_G_MIN_PER_KG = 0.6;       // g fat per kg body weight floor
    this.FAT_MIN_PCT = 0.25;           // 25% calories floor for fat
    this.KCAL_PER_KG_WEEK = 7700;      // kcal per kg of weight change
    this.EX_MET_DEFAULT = 6.0;         // circuit/strength moderate
    this.EX_SESSION_MIN_DEFAULT = 45;  // minutes
    this.STEP_KCAL_PER_STEP_PER_KG = 0.04;
    
    // NEAT baseline by occupation (as % of RMR)
    this.NEAT_PCT = {
      'desk': 0.10,
      'mixed': 0.15,
      'standing': 0.25,
      'labor': 0.35
    };
  }

  /**
   * Calculate Resting Metabolic Rate using Mifflin-St Jeor equation
   * @param {Object} params - {sex_at_birth, age_years, height_cm, weight_kg}
   * @returns {number} RMR in kcal/day
   */
  calculateRMR({ sex_at_birth, age_years, height_cm, weight_kg }) {
    const W = weight_kg;
    const H = height_cm;
    const A = age_years;

    if (sex_at_birth === 'male') {
      return 10 * W + 6.25 * H - 5 * A + 5;
    } else {
      return 10 * W + 6.25 * H - 5 * A - 161;
    }
  }

  /**
   * Calculate TDEE (Total Daily Energy Expenditure)
   * @param {Object} params - Input parameters
   * @returns {Object} {tdee, movement_kcal_day, method_used}
   */
  calculateTDEE({ 
    rmr, 
    apple_active_kcal_day, 
    workouts_per_week, 
    weight_kg, 
    occupation_level = 'mixed',
    steps = 0 
  }) {
    // Path A: Apple Health data (preferred)
    if (apple_active_kcal_day !== null && apple_active_kcal_day !== undefined) {
      // For now, use the value directly (in production, implement EMA7 smoothing)
      const movement_kcal_day = apple_active_kcal_day;
      const tdee = rmr + movement_kcal_day;
      
      return {
        tdee: Math.round(tdee),
        movement_kcal_day: Math.round(movement_kcal_day),
        method_used: 'apple_health'
      };
    }

    // Path B: Fallback calculation
    const neat_kcal_base = rmr * (this.NEAT_PCT[occupation_level] || 0.30);
    const steps_kcal = steps * weight_kg * this.STEP_KCAL_PER_STEP_PER_KG;
    
    let exercise_kcal_daily = 0;
    if (workouts_per_week && workouts_per_week > 0) {
      const exercise_kcal_per_session = this.EX_MET_DEFAULT * weight_kg * (this.EX_SESSION_MIN_DEFAULT / 60);
      exercise_kcal_daily = (workouts_per_week * exercise_kcal_per_session) / 7;
    }

    const movement_kcal_day = neat_kcal_base + steps_kcal + exercise_kcal_daily;
    const tdee = rmr + movement_kcal_day;

    return {
      tdee: Math.round(tdee),
      movement_kcal_day: Math.round(movement_kcal_day),
      method_used: 'fallback'
    };
  }

  /**
   * Calculate daily calorie delta based on pace
   * @param {number} pace_kg_per_week - Weight change per week
   * @returns {number} Daily calorie delta
   */
  calculateDailyCalorieDelta(pace_kg_per_week) {
    const weekly_kcal_delta = pace_kg_per_week * this.KCAL_PER_KG_WEEK;
    return weekly_kcal_delta / 7;
  }

  /**
   * Apply safety floors for calorie targets
   * @param {Object} params - {calorie_target, rmr, sex_at_birth}
   * @returns {Object} {calorie_target, floor_applied, warning}
   */
  applySafetyFloors({ calorie_target, rmr, sex_at_birth }) {
    const floor = sex_at_birth === 'male' 
      ? Math.max(1500, rmr * 0.8)
      : Math.max(1200, rmr * 0.8);

    if (calorie_target < floor) {
      return {
        calorie_target: Math.round(floor),
        floor_applied: true,
        warning: `Calorie target was below safety floor (${Math.round(floor)} kcal). Adjusted to maintain health.`
      };
    }

    return {
      calorie_target: Math.round(calorie_target),
      floor_applied: false,
      warning: null
    };
  }

  /**
   * Calculate macro targets
   * @param {Object} params - {calorie_target, weight_kg}
   * @returns {Object} Macro targets in grams
   */
  calculateMacros({ calorie_target, weight_kg }) {
    // Protein calculation
    const protein_g = this.PRO_G_PER_KG * weight_kg;
    const protein_kcal = 4 * protein_g;

    // Fat calculation (floor)
    const fat_kcal_floor = Math.max(
      this.FAT_MIN_PCT * calorie_target,
      9 * this.FAT_G_MIN_PER_KG * weight_kg
    );
    const fat_g = fat_kcal_floor / 9;

    // Carb calculation (remaining calories)
    const carb_kcal = calorie_target - protein_kcal - fat_kcal_floor;
    const carb_g = carb_kcal / 4;

    return {
      protein_g: Math.round(protein_g),
      fat_g: Math.round(fat_g),
      carb_g: Math.round(carb_g),
      protein_kcal: Math.round(protein_kcal),
      fat_kcal: Math.round(fat_kcal_floor),
      carb_kcal: Math.round(carb_kcal)
    };
  }

  /**
   * Round values according to business rules
   * @param {Object} values - Values to round
   * @returns {Object} Rounded values
   */
  roundValues({ calorie_target, protein_g, fat_g, carb_g }) {
    return {
      calorie_target: Math.round(calorie_target / 25) * 25,  // nearest 25 kcal
      protein_g: Math.round(protein_g / 5) * 5,              // nearest 5 g
      fat_g: Math.round(fat_g / 5) * 5,                    // nearest 5 g
      carb_g: Math.round(carb_g / 5) * 5                   // nearest 5 g
    };
  }

  /**
   * Main calculation function (v1 - Legacy)
   * @param {Object} inputs - All input parameters
   * @returns {Object} Complete calculation results
   */
  computeTargetsV1(inputs) {
    try {
      // Validate required inputs
      const required = ['sex_at_birth', 'age_years', 'height_cm', 'weight_kg', 'goal_type', 'pace_kg_per_week'];
      for (const field of required) {
        if (inputs[field] === undefined || inputs[field] === null) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // 1) Calculate RMR
      const rmr = this.calculateRMR({
        sex_at_birth: inputs.sex_at_birth,
        age_years: inputs.age_years,
        height_cm: inputs.height_cm,
        weight_kg: inputs.weight_kg
      });

      // 2) Calculate TDEE
      const tdeeResult = this.calculateTDEE({
        rmr,
        apple_active_kcal_day: inputs.apple_active_kcal_day,
        workouts_per_week: inputs.workouts_per_week || 0,
        weight_kg: inputs.weight_kg,
        occupation_level: inputs.occupation_level || 'mixed',
        steps: inputs.steps || 0
      });

      // 3) Calculate daily calorie delta
      const daily_kcal_delta = this.calculateDailyCalorieDelta(inputs.pace_kg_per_week);

      // 4) Calculate initial calorie target
      const initial_calorie_target = tdeeResult.tdee + daily_kcal_delta;

      // 5) Apply safety floors
      const floorResult = this.applySafetyFloors({
        calorie_target: initial_calorie_target,
        rmr,
        sex_at_birth: inputs.sex_at_birth
      });

      // 6) Calculate macros
      const macros = this.calculateMacros({
        calorie_target: floorResult.calorie_target,
        weight_kg: inputs.weight_kg
      });

      // 7) Round final values
      const rounded = this.roundValues({
        calorie_target: floorResult.calorie_target,
        protein_g: macros.protein_g,
        fat_g: macros.fat_g,
        carb_g: macros.carb_g
      });

      // 8) Prepare final result
      const result = {
        rmr: Math.round(rmr),
        tdee: tdeeResult.tdee,
        movement_kcal_day: tdeeResult.movement_kcal_day,
        method_used: tdeeResult.method_used,
        daily_kcal_delta: Math.round(daily_kcal_delta),
        calorie_target: rounded.calorie_target,
        macros: {
          protein_g: rounded.protein_g,
          fat_g: rounded.fat_g,
          carb_g: rounded.carb_g
        },
        safety: {
          floor_applied: floorResult.floor_applied,
          warning: floorResult.warning
        },
        inputs: {
          sex_at_birth: inputs.sex_at_birth,
          age_years: inputs.age_years,
          height_cm: inputs.height_cm,
          weight_kg: inputs.weight_kg,
          goal_type: inputs.goal_type,
          pace_kg_per_week: inputs.pace_kg_per_week,
          workouts_per_week: inputs.workouts_per_week || 0,
          apple_active_kcal_day: inputs.apple_active_kcal_day
        }
      };

      return result;

    } catch (error) {
      throw new Error(`Calculation failed: ${error.message}`);
    }
  }

  /**
   * Calculate NEAT (Non-Exercise Activity Thermogenesis) based on activity level
   * @param {Object} params - {rmr, activity_level}
   * @returns {number} NEAT calories per day
   */
  calculateNEAT({ rmr, activity_level }) {
    const neatMultipliers = {
      'sedentary': 0.10,    // +10%
      'light': 0.20,        // +20%
      'active': 0.30,       // +30%
      'very_active': 0.40,  // +40%
      'dynamic': 0.30       // +30% (midpoint)
    };

    const neatPct = neatMultipliers[activity_level] || 0.30;
    return rmr * neatPct;
  }

  /**
   * Calculate EAT (Exercise Activity Thermogenesis) for structured workouts
   * @param {Object} params - {weight_kg, workouts_per_week, avg_workout_duration_min, avg_workout_intensity}
   * @returns {number} Daily EAT calories
   */
  calculateEAT({ weight_kg, workouts_per_week, avg_workout_duration_min, avg_workout_intensity }) {
    const metValues = {
      'low': 3.5,
      'moderate': 7.0,
      'high': 9.5
    };

    const met = metValues[avg_workout_intensity] || 7.0;
    const duration_hours = (avg_workout_duration_min || 45) / 60;
    
    const eatPerSession = met * weight_kg * duration_hours;
    const eatDaily = (workouts_per_week * eatPerSession) / 7;
    
    return eatDaily;
  }

  /**
   * Calculate adaptive macros based on goal type
   * @param {Object} params - {calorie_target, weight_kg, goal_type}
   * @returns {Object} Macro targets in grams
   */
  calculateAdaptiveMacros({ calorie_target, weight_kg, goal_type }) {
    const macroConfigs = {
      'lose': { protein_factor: 2.0, fat_pct: 0.25 },
      'maintain': { protein_factor: 1.6, fat_pct: 0.30 },
      'gain': { protein_factor: 2.2, fat_pct: 0.25 },
      // Recomposition: maintenance kcal with high protein for muscle
      // preservation and generous fat since calories aren't restricted.
      'recomp': { protein_factor: 2.0, fat_pct: 0.30 }
    };

    const config = macroConfigs[goal_type] || macroConfigs['maintain'];
    
    // Protein calculation
    const protein_g = config.protein_factor * weight_kg;
    const protein_kcal = 4 * protein_g;

    // Fat calculation (with minimum floor)
    const fat_kcal_floor = Math.max(
      config.fat_pct * calorie_target,
      9 * 0.6 * weight_kg  // Minimum 0.6 g/kg
    );
    const fat_g = fat_kcal_floor / 9;

    // Carb calculation (remaining calories)
    const carb_kcal = calorie_target - protein_kcal - fat_kcal_floor;
    const carb_g = carb_kcal / 4;

    return {
      protein_g: Math.round(protein_g),
      fat_g: Math.round(fat_g),
      carb_g: Math.round(carb_g),
      protein_kcal: Math.round(protein_kcal),
      fat_kcal: Math.round(fat_kcal_floor),
      carb_kcal: Math.round(carb_kcal)
    };
  }

  /**
   * Apply v2 safety guardrails
   * @param {Object} params - {calorie_target, rmr, sex_at_birth, protein_g, fat_g, weight_kg}
   * @returns {Object} Adjusted values with warnings
   */
  applyV2Guardrails({ calorie_target, rmr, sex_at_birth, protein_g, fat_g, weight_kg }) {
    const warnings = [];
    let adjustedCalorieTarget = calorie_target;
    let adjustedProtein = protein_g;
    let adjustedFat = fat_g;

    // Calorie floor — PRD: 1,400 (male) / 1,200 (female). Same floor will
    // apply to the Dynamic baseline calc when CAL-22 lands.
    const calorieFloor = sex_at_birth === 'male' ? 1400 : 1200;
    if (adjustedCalorieTarget < calorieFloor) {
      adjustedCalorieTarget = calorieFloor;
      warnings.push(`Calorie target adjusted to safety floor (${calorieFloor} kcal)`);
    }

    // Protein minimum (1.4 g/kg)
    const proteinMin = 1.4 * weight_kg;
    if (adjustedProtein < proteinMin) {
      adjustedProtein = proteinMin;
      warnings.push(`Protein adjusted to minimum (${Math.round(proteinMin)}g)`);
    }

    // Fat minimum (0.6 g/kg)
    const fatMin = 0.6 * weight_kg;
    if (adjustedFat < fatMin) {
      adjustedFat = fatMin;
      warnings.push(`Fat adjusted to minimum (${Math.round(fatMin)}g)`);
    }

    return {
      calorie_target: adjustedCalorieTarget,
      protein_g: adjustedProtein,
      fat_g: adjustedFat,
      warnings
    };
  }

  /**
   * Main calculation function (v2 - Unified Energy Model)
   * @param {Object} inputs - All input parameters
   * @returns {Object} Complete calculation results
   */
  computeTargetsV2(inputs) {
    try {
      // Validate required inputs
      const required = ['sex_at_birth', 'age_years', 'height_cm', 'weight_kg', 'goal_type', 'pace_kg_per_week', 'activity_level'];
      for (const field of required) {
        if (inputs[field] === undefined || inputs[field] === null) {
          throw new Error(`Missing required field: ${field}`);
        }
      }

      // 1) Calculate RMR using Mifflin-St Jeor
      const rmr = this.calculateRMR({
        sex_at_birth: inputs.sex_at_birth,
        age_years: inputs.age_years,
        height_cm: inputs.height_cm,
        weight_kg: inputs.weight_kg
      });

      // 2) Calculate NEAT based on activity level
      const neat_kcal = this.calculateNEAT({
        rmr,
        activity_level: inputs.activity_level || 'active'
      });

      // 3) Calculate EAT for structured workouts
      const eat_kcal = this.calculateEAT({
        weight_kg: inputs.weight_kg,
        workouts_per_week: inputs.workouts_per_week || 0,
        avg_workout_duration_min: inputs.avg_workout_duration_min || 45,
        avg_workout_intensity: inputs.avg_workout_intensity || 'moderate'
      });

      // 4) Calculate TDEE
      const tdee = rmr + neat_kcal + eat_kcal;

      // 5) Calculate goal adjustment
      const weekly_kcal_delta = inputs.pace_kg_per_week * this.KCAL_PER_KG_WEEK;
      const daily_kcal_delta = weekly_kcal_delta / 7;
      const calorie_target = tdee + daily_kcal_delta;

      // 6) Calculate adaptive macros
      const macros = this.calculateAdaptiveMacros({
        calorie_target,
        weight_kg: inputs.weight_kg,
        goal_type: inputs.goal_type
      });

      // 7) Apply guardrails
      const guardrailResult = this.applyV2Guardrails({
        calorie_target,
        rmr,
        sex_at_birth: inputs.sex_at_birth,
        protein_g: macros.protein_g,
        fat_g: macros.fat_g,
        weight_kg: inputs.weight_kg
      });

      // 8) Round final values
      const rounded = this.roundValues({
        calorie_target: guardrailResult.calorie_target,
        protein_g: guardrailResult.protein_g,
        fat_g: guardrailResult.fat_g,
        carb_g: macros.carb_g
      });

      // 9) Prepare final result
      const result = {
        rmr: Math.round(rmr),
        neat_kcal: Math.round(neat_kcal),
        eat_kcal: Math.round(eat_kcal),
        tdee: Math.round(tdee),
        daily_kcal_delta: Math.round(daily_kcal_delta),
        calorie_target: rounded.calorie_target,
        macros: {
          protein_g: rounded.protein_g,
          fat_g: rounded.fat_g,
          carb_g: rounded.carb_g
        },
        version: 'v2',
        warnings: guardrailResult.warnings,
        inputs: {
          sex_at_birth: inputs.sex_at_birth,
          age_years: inputs.age_years,
          height_cm: inputs.height_cm,
          weight_kg: inputs.weight_kg,
          goal_type: inputs.goal_type,
          pace_kg_per_week: inputs.pace_kg_per_week,
          activity_level: inputs.activity_level || 'active',
          workouts_per_week: inputs.workouts_per_week || 0,
          avg_workout_duration_min: inputs.avg_workout_duration_min || 45,
          avg_workout_intensity: inputs.avg_workout_intensity || 'moderate'
        }
      };

      return result;

    } catch (error) {
      throw new Error(`V2 calculation failed: ${error.message}`);
    }
  }

  /**
   * Main calculation function (defaults to v1 for backward compatibility)
   * @param {Object} inputs - All input parameters
   * @returns {Object} Complete calculation results
   */
  computeTargets(inputs) {
    return this.computeTargetsV1(inputs);
  }

  /**
   * Validate input parameters
   * @param {Object} inputs - Input parameters to validate
   * @returns {Object} Validation result
   */
  validateInputs(inputs) {
    const errors = [];
    const warnings = [];

    // Required field validation
    const required = {
      sex_at_birth: { type: 'enum', values: ['male', 'female'] },
      age_years: { type: 'number', min: 13, max: 80 },
      height_cm: { type: 'number', min: 120, max: 220 },
      weight_kg: { type: 'number', min: 35, max: 250 },
      goal_type: { type: 'enum', values: ['lose', 'maintain', 'gain', 'recomp'] },
      pace_kg_per_week: { type: 'number', min: -1.5, max: 1.5 }
    };

    for (const [field, rules] of Object.entries(required)) {
      const value = inputs[field];
      
      if (value === undefined || value === null) {
        errors.push(`Missing required field: ${field}`);
        continue;
      }

      if (rules.type === 'enum' && !rules.values.includes(value)) {
        errors.push(`${field} must be one of: ${rules.values.join(', ')}`);
      }

      if (rules.type === 'number') {
        if (typeof value !== 'number' || isNaN(value)) {
          errors.push(`${field} must be a valid number`);
        } else if (value < rules.min || value > rules.max) {
          errors.push(`${field} must be between ${rules.min} and ${rules.max}`);
        }
      }
    }

    // Optional field validation
    if (inputs.workouts_per_week !== undefined) {
      if (typeof inputs.workouts_per_week !== 'number' || inputs.workouts_per_week < 0 || inputs.workouts_per_week > 14) {
        errors.push('workouts_per_week must be between 0 and 14');
      }
    }

    if (inputs.desired_weight_kg !== undefined) {
      if (typeof inputs.desired_weight_kg !== 'number' || inputs.desired_weight_kg < 30 || inputs.desired_weight_kg > 250) {
        errors.push('desired_weight_kg must be between 30 and 250');
      }
    }

    if (inputs.apple_active_kcal_day !== undefined && inputs.apple_active_kcal_day !== null) {
      if (typeof inputs.apple_active_kcal_day !== 'number' || inputs.apple_active_kcal_day < 0) {
        errors.push('apple_active_kcal_day must be a non-negative number');
      }
    }

    // Conflict detection
    if (inputs.goal_type && inputs.pace_kg_per_week !== undefined) {
      const goalSign = inputs.goal_type === 'lose' ? -1 : inputs.goal_type === 'gain' ? 1 : 0;
      const paceSign = Math.sign(inputs.pace_kg_per_week);
      
      if (goalSign !== 0 && paceSign !== 0 && goalSign !== paceSign) {
        warnings.push(`Goal type (${inputs.goal_type}) conflicts with pace (${inputs.pace_kg_per_week} kg/week). Using pace for calculations.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }
}

module.exports = new GoalService();
