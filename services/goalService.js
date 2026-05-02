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

    // CAL-22: Dynamic-goal constants (PRD §7.3, §7.4, §7.5).
    // Tunable here so the choice-screen example numbers and bonus
    // coefficients can be adjusted without an app release.
    this.DYNAMIC = {
      SEDENTARY_MULTIPLIER: 1.2,            // PRD §7.3
      STEP_COEF: 0.05,                      // kcal/step, PRD §7.4 (CAL-17 audit)
      WORKOUT_HAIRCUT: 0.5,                 // 50% net of workout cal, PRD §7.4
      // Choice-screen illustrative assumptions (PRD §7.5)
      PREVIEW_REST_STEPS: 3000,
      PREVIEW_ACTIVE_STEPS: 8000,
      PREVIEW_WORKOUT_KCAL: 250,            // illustrative 30-min workout
      // Static-row activity_level. The choice screen runs before the
      // static lifestyle questions (PRD §8 / CAL-26 fallback routing), so
      // the caller never has a real activity_level — we always pin this
      // constant. Tunable here if telemetry shows users typically land
      // somewhere other than 'moderately_active' in the static flow.
      PREVIEW_STATIC_ACTIVITY_LEVEL: 'moderately_active'
    };

    // CAL-35: Standard activity multipliers (PAL bands). Each band's
    // multiplier × RMR yields TDEE — bakes in both NEAT and typical EAT
    // for that lifestyle, so we no longer ask workouts/week separately.
    //
    // Empirical basis (so we can defend the numbers):
    //   FAO/WHO/UNU 1985 + 2001 expert consultations on human energy
    //   requirements; IOM 2002 DRI report; popularized by McArdle/Katch/
    //   Katch *Exercise Physiology*. Values derived from doubly-labeled-
    //   water studies measuring real free-living TDEE across activity
    //   strata.
    //
    // Self-report inflation is well-documented (Tooze 2007, Schoeller
    // 1995): users tend to pick one band higher than reality. The seed's
    // option subtext should lean conservative; this constant doesn't
    // need to change to compensate.
    this.ACTIVITY_MULTIPLIERS = {
      sedentary: 1.2,
      lightly_active: 1.375,
      moderately_active: 1.55,
      very_active: 1.725,
      extra_active: 1.9
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

  // CAL-35 removed calculateNEAT and calculateEAT. The v2 path now uses
  // a single activity multiplier (ACTIVITY_MULTIPLIERS) that bakes both
  // NEAT and typical EAT into one band, replacing the custom % split.

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

      // CAL-35: TDEE = RMR × ACTIVITY_MULTIPLIER. The multiplier bakes in
      // both NEAT and typical EAT for the band, so workouts/week is no
      // longer a separate input. See ACTIVITY_MULTIPLIERS comment for
      // the empirical basis.
      const multiplier = this.ACTIVITY_MULTIPLIERS[inputs.activity_level];
      if (multiplier === undefined) {
        throw new Error(
          `Invalid activity_level '${inputs.activity_level}'. ` +
          `Expected one of: ${Object.keys(this.ACTIVITY_MULTIPLIERS).join(', ')}`
        );
      }

      // 1) Calculate RMR using Mifflin-St Jeor
      const rmr = this.calculateRMR({
        sex_at_birth: inputs.sex_at_birth,
        age_years: inputs.age_years,
        height_cm: inputs.height_cm,
        weight_kg: inputs.weight_kg
      });

      // 2) TDEE = RMR × multiplier. PAL band bakes in NEAT + typical EAT.
      const tdee = rmr * multiplier;

      // 3) Calculate goal adjustment.
      //    PRD §6.2: recomp is maintenance kcal regardless of any pace input.
      //    Coerce pace to 0 for the calc; validateInputs surfaces a warning
      //    when the client sent a non-zero value, so the override is visible.
      const paceForCalc = inputs.goal_type === 'recomp' ? 0 : inputs.pace_kg_per_week;
      const weekly_kcal_delta = paceForCalc * this.KCAL_PER_KG_WEEK;
      const daily_kcal_delta = weekly_kcal_delta / 7;
      const calorie_target = tdee + daily_kcal_delta;

      // 4) Calculate adaptive macros
      const macros = this.calculateAdaptiveMacros({
        calorie_target,
        weight_kg: inputs.weight_kg,
        goal_type: inputs.goal_type
      });

      // 5) Apply guardrails
      const guardrailResult = this.applyV2Guardrails({
        calorie_target,
        rmr,
        sex_at_birth: inputs.sex_at_birth,
        protein_g: macros.protein_g,
        fat_g: macros.fat_g,
        weight_kg: inputs.weight_kg
      });

      // 6) Round final values
      const rounded = this.roundValues({
        calorie_target: guardrailResult.calorie_target,
        protein_g: guardrailResult.protein_g,
        fat_g: guardrailResult.fat_g,
        carb_g: macros.carb_g
      });

      // 7) Prepare final result. neat_kcal/eat_kcal removed (no longer split);
      // tdee is the single derived intermediate.
      const result = {
        rmr: Math.round(rmr),
        tdee: Math.round(tdee),
        activity_multiplier: multiplier,
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
          activity_level: inputs.activity_level
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

    // Required field validation. CAL-35: activity_level is now strict-enum
    // against the standard PAL bands (matches ACTIVITY_MULTIPLIERS keys).
    const required = {
      sex_at_birth: { type: 'enum', values: ['male', 'female'] },
      age_years: { type: 'number', min: 13, max: 80 },
      height_cm: { type: 'number', min: 120, max: 220 },
      weight_kg: { type: 'number', min: 35, max: 250 },
      goal_type: { type: 'enum', values: ['lose', 'maintain', 'gain', 'recomp'] },
      pace_kg_per_week: { type: 'number', min: -1.5, max: 1.5 },
      activity_level: {
        type: 'enum',
        values: ['sedentary', 'lightly_active', 'moderately_active', 'very_active', 'extra_active'],
        optional: true  // computeTargetsV2 enforces presence; computeChoicePreview / computeDynamicBaseline don't need it.
      }
    };

    for (const [field, rules] of Object.entries(required)) {
      const value = inputs[field];

      if (value === undefined || value === null) {
        if (!rules.optional) {
          errors.push(`Missing required field: ${field}`);
        }
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

    // CAL-35: workouts_per_week, avg_workout_duration_min, and
    // avg_workout_intensity were inputs to the old NEAT+EAT model and
    // are no longer required or validated. Standard activity multipliers
    // bake exercise into the activity_level band.

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

      // PRD §6.2: recomp is maintenance kcal — pace must be 0. The general
      // sign-conflict check above doesn't fire for recomp because goalSign=0,
      // so we add an explicit clause. computeTargetsV2 coerces pace to 0
      // for the calculation regardless; this surfaces the misuse to clients.
      if (inputs.goal_type === 'recomp' && paceSign !== 0) {
        warnings.push(`Goal type 'recomp' requires pace=0 (maintenance kcal). Got ${inputs.pace_kg_per_week}; coercing to 0.`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * CAL-22: Dynamic-goal baseline calculation (PRD §7.3).
   *
   * Distinct from `computeTargetsV2`: uses the sedentary multiplier (1.2)
   * with NO activity-level NEAT, NO EAT for workouts. Activity is added
   * separately as a daily flex (CAL-23). Producing two different "baseline"
   * numbers is intentional — a Dynamic user's persisted baseline must not
   * already include activity, otherwise CAL-23's `today = baseline + bonus`
   * double-counts.
   *
   * Mirrors `computeTargetsV2`'s recomp coercion (services/goalService.js
   * pace-for-recomp clause) and floor (1400 male / 1200 female).
   *
   * @param {Object} inputs
   *   sex_at_birth, age_years, height_cm, weight_kg, goal_type,
   *   pace_kg_per_week
   * @returns {{rmr:number, sedentary_tdee:number, daily_kcal_delta:number,
   *           pre_floor:number, floor:number, floor_applied:boolean,
   *           baseline:number}}
   */
  computeDynamicBaseline(inputs) {
    const required = ['sex_at_birth', 'age_years', 'height_cm', 'weight_kg', 'goal_type', 'pace_kg_per_week'];
    for (const field of required) {
      if (inputs[field] === undefined || inputs[field] === null) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    const rmr = this.calculateRMR({
      sex_at_birth: inputs.sex_at_birth,
      age_years: inputs.age_years,
      height_cm: inputs.height_cm,
      weight_kg: inputs.weight_kg
    });
    const sedentary_tdee = rmr * this.DYNAMIC.SEDENTARY_MULTIPLIER;

    // PRD §6.2: recomp is maintenance kcal regardless of pace.
    const paceForCalc = inputs.goal_type === 'recomp' ? 0 : inputs.pace_kg_per_week;
    const daily_kcal_delta = (paceForCalc * this.KCAL_PER_KG_WEEK) / 7;

    const pre_floor = sedentary_tdee + daily_kcal_delta;
    const floor = inputs.sex_at_birth === 'male' ? 1400 : 1200;
    // Round to nearest 5 so the four choice-screen numbers share a
    // display grid: static is round-to-25 via computeTargetsV2's
    // roundValues, the dynamic rows here round to 5, and the +150/+400/
    // +525 offsets in computeChoicePreview keep the dynamic rows on the
    // same 5-grid. Coarser than the macro round-to-25 (which would shift
    // PRD §12 examples by up to 5) and finer than round-to-1 (which would
    // strand the dynamic numbers on a different grid than static).
    const pre_floor_rounded = Math.round(pre_floor / 5) * 5;
    const baseline = Math.max(pre_floor_rounded, floor);

    return {
      rmr: Math.round(rmr),
      sedentary_tdee: Math.round(sedentary_tdee),
      daily_kcal_delta: Math.round(daily_kcal_delta),
      pre_floor: Math.round(pre_floor),
      floor,
      floor_applied: pre_floor_rounded < floor,
      baseline
    };
  }

  /**
   * CAL-22: Build the four numbers the Dynamic-vs-Static choice screen
   * renders (PRD §6.4, §7.5). The Static row uses `computeTargetsV2` with
   * activity_level pinned to the PREVIEW_STATIC_ACTIVITY_LEVEL constant
   * (the choice screen runs before the user has answered the static
   * lifestyle questions, so any caller-supplied activity_level would be
   * meaningless here). The three Dynamic rows derive from the BMR×1.2
   * baseline plus illustrative step/workout assumptions.
   *
   * Caveat: a permission-denied user who later picks `sedentary` in the
   * static-lifestyle flow will see a slightly lower persisted static than
   * the choice-screen preview. Acceptable for v1 — preview is illustrative.
   *
   * @param {Object} inputs - sex_at_birth, age_years, height_cm,
   *   weight_kg, goal_type, pace_kg_per_week. Any v2-only fields
   *   (activity_level, workouts_per_week, etc.) are ignored — the static
   *   row pins activity_level to the constant for consistency.
   * @returns {Object} { static, dynamic_baseline, dynamic_rest,
   *   dynamic_active, dynamic_workout, meta }
   */
  computeChoicePreview(inputs) {
    const baselineResult = this.computeDynamicBaseline(inputs);
    const { baseline, floor, floor_applied } = baselineResult;

    // Static row: pin activity_level + zero out workout fields so two
    // requests with the same demographics always produce the same static
    // value, regardless of whatever optional v2 fields the caller passes.
    const staticResult = this.computeTargetsV2({
      ...inputs,
      activity_level: this.DYNAMIC.PREVIEW_STATIC_ACTIVITY_LEVEL,
      workouts_per_week: 0
    });

    // baseline is already on the 5-grid (computeDynamicBaseline) and the
    // step/workout offsets are integer multiples of 5 (3000×0.05=150,
    // 8000×0.05=400, 250×0.5=125), so the sums stay on the 5-grid. The
    // outer Math.round just cleans up any float drift from 0.05 × N.
    const dynamic_rest = Math.round(
      baseline + this.DYNAMIC.PREVIEW_REST_STEPS * this.DYNAMIC.STEP_COEF
    );
    const dynamic_active = Math.round(
      baseline + this.DYNAMIC.PREVIEW_ACTIVE_STEPS * this.DYNAMIC.STEP_COEF
    );
    const dynamic_workout = Math.round(
      baseline +
        this.DYNAMIC.PREVIEW_ACTIVE_STEPS * this.DYNAMIC.STEP_COEF +
        this.DYNAMIC.PREVIEW_WORKOUT_KCAL * this.DYNAMIC.WORKOUT_HAIRCUT
    );

    return {
      static: staticResult.calorie_target,
      dynamic_baseline: baseline,
      dynamic_rest,
      dynamic_active,
      dynamic_workout,
      meta: {
        floor,
        floor_applied,
        // Surface assumptions so the client can render disclosure copy
        // (e.g. "assuming a 30-min, 250-cal workout") without duplicating
        // constants. Tunable on the backend.
        assumptions: {
          rest_steps: this.DYNAMIC.PREVIEW_REST_STEPS,
          active_steps: this.DYNAMIC.PREVIEW_ACTIVE_STEPS,
          workout_kcal: this.DYNAMIC.PREVIEW_WORKOUT_KCAL,
          step_coef: this.DYNAMIC.STEP_COEF,
          workout_haircut: this.DYNAMIC.WORKOUT_HAIRCUT
        }
      }
    };
  }

  /**
   * CAL-21: Resolve the user's Dynamic-vs-Static intent into the four
   * persisted fields (goalType, intent, outcome, baselineGoal).
   *
   * intent and outcome are independent so a future "re-enable Dynamic"
   * prompt can target users with intent=dynamic AND outcome != 'dynamic'.
   *
   * baselineGoal semantics (CAL-22):
   *   • mode='static' — uses calorieTarget (the v2 result with NEAT). For
   *     static users this is documentational; nothing reads baselineGoal.
   *   • mode='dynamic' (any outcome, including permission-denied fallbacks
   *     where intent stays 'dynamic') — uses dynamicBaseline (BMR×1.2 ±
   *     delta, floored). CAL-23 reads baselineGoal and adds activity bonus
   *     on top, so it must be the bonus-free dynamic baseline. Persisting
   *     it on fallback paths means a future re-enable-Dynamic prompt can
   *     fire without forcing a fresh calculation.
   *
   * @param {Object} params
   * @param {'dynamic'|'static'} params.mode - User's choice at the picker.
   * @param {string} [params.outcome] - Optional override; only valid when
   *   mode='dynamic'. Accepts 'static_permission_denied' (HealthKit denied)
   *   or 'static_sync_failed' (HealthKit reachable but sync errored).
   * @param {number} params.calorieTarget - The v2 calorie target.
   * @param {number} params.dynamicBaseline - The BMR×1.2 dynamic baseline.
   *   Required for mode='dynamic'; ignored for mode='static'.
   * @returns {{goalType:string,intent:string,outcome:string,baselineGoal:number}}
   * @throws {Error} on invalid mode / outcome combination.
   */
  resolveGoalMode({ mode, outcome, calorieTarget, dynamicBaseline }) {
    if (mode !== 'dynamic' && mode !== 'static') {
      throw new Error("mode must be 'dynamic' or 'static'");
    }
    if (mode === 'static') {
      if (outcome !== undefined) {
        throw new Error("outcome override is only valid when mode='dynamic'");
      }
      return {
        goalType: 'static',
        intent: 'static',
        outcome: 'static_chosen',
        baselineGoal: calorieTarget
      };
    }
    // mode === 'dynamic' — baselineGoal is always the BMR×1.2 baseline.
    if (dynamicBaseline === undefined || dynamicBaseline === null) {
      throw new Error("dynamicBaseline is required when mode='dynamic'");
    }
    if (outcome === undefined) {
      return {
        goalType: 'dynamic',
        intent: 'dynamic',
        outcome: 'dynamic',
        baselineGoal: dynamicBaseline
      };
    }
    if (outcome === 'static_permission_denied' || outcome === 'static_sync_failed') {
      return {
        goalType: 'static',
        intent: 'dynamic',
        outcome,
        baselineGoal: dynamicBaseline
      };
    }
    throw new Error(
      "outcome override must be 'static_permission_denied' or 'static_sync_failed'"
    );
  }

  /**
   * CAL-23: Pure math for today's calorie goal under the Dynamic variant.
   * `today's_goal = baselineGoal + min(stepBonus + workoutBonus, 50% × baseline)`
   *
   * Step bonus uses gross daily steps. PRD §7.4 calls for excluding
   * workout-window steps, but ActivityStore stores only daily totals per
   * source — no intraday breakdown and no per-workout steps field — so the
   * dedup isn't computable from current data. The 50% cap bounds the
   * impact; revisit if a future health-sync surface adds per-workout step
   * counts. See CAL-23 plan for details.
   *
   * Workout bonus subtracts BMR-during-workout (rmr/1440 × duration_min)
   * from each workout's gross calories before applying the 50% haircut, so
   * we don't credit users for kcal they would have burned at rest anyway.
   * The max(0, …) guard zeroes degenerate cases (low-MET workout reporting
   * fewer kcal than rest BMR for the duration).
   *
   * Pure / deterministic / idempotent — same inputs always produce the
   * same output, no I/O.
   *
   * @param {Object} params
   * @param {number} params.baselineGoal - Bonus-free BMR×1.2 baseline
   *   (User.goals.baselineGoal). The cap is computed from this.
   * @param {number} params.netSteps - Gross daily steps (no workout-window
   *   dedup; see note above).
   * @param {Array<{calories_burned:number, duration_min:number}>} params.workouts
   *   Today's workouts. Items missing or with non-finite calories_burned /
   *   duration_min contribute 0.
   * @param {number} params.rmrPerDay - User's Mifflin-St Jeor RMR in
   *   kcal/day (User.goals.rmr).
   * @returns {{
   *   stepBonus:number, workoutBonus:number,
   *   bonusUncapped:number, bonusApplied:number, capped:boolean,
   *   todaysGoal:number,
   *   breakdown:{
   *     netSteps:number,
   *     workouts:Array<{kcal_burned:number, duration_min:number,
   *                     bmr_during:number, net_kcal:number,
   *                     contribution:number}>
   *   }
   * }}
   */
  computeTodaysGoal({ baselineGoal, netSteps, workouts, rmrPerDay }) {
    if (!Number.isFinite(baselineGoal) || baselineGoal <= 0) {
      throw new Error('baselineGoal must be a positive number');
    }
    if (!Number.isFinite(rmrPerDay) || rmrPerDay <= 0) {
      throw new Error('rmrPerDay must be a positive number');
    }

    const safeSteps = Number.isFinite(netSteps) && netSteps > 0 ? netSteps : 0;
    const stepBonus = safeSteps * this.DYNAMIC.STEP_COEF;

    const bmrPerMin = rmrPerDay / 1440;
    const workoutBreakdown = [];
    let workoutBonus = 0;
    for (const w of workouts || []) {
      // Skip malformed entries — without both kcal and duration we can't
      // net out BMR-during-workout, so crediting them risks inflating the
      // bonus from bad sync payloads. Logged in the breakdown as a no-op
      // would be noisy; dropping them is cleaner.
      if (!w || !Number.isFinite(w.calories_burned) || !Number.isFinite(w.duration_min)) {
        continue;
      }
      const kcal = w.calories_burned;
      const dur = w.duration_min;
      const bmrDuring = bmrPerMin * dur;
      const netKcal = Math.max(0, kcal - bmrDuring);
      const contribution = netKcal * this.DYNAMIC.WORKOUT_HAIRCUT;
      workoutBonus += contribution;
      workoutBreakdown.push({
        kcal_burned: Math.round(kcal),
        duration_min: Math.round(dur),
        bmr_during: Math.round(bmrDuring),
        net_kcal: Math.round(netKcal),
        contribution: Math.round(contribution)
      });
    }

    const bonusUncapped = stepBonus + workoutBonus;
    const cap = 0.5 * baselineGoal;
    const capped = bonusUncapped > cap;
    const bonusApplied = capped ? cap : bonusUncapped;

    // Round todaysGoal to nearest 5 so the home-page number stays on the
    // same 5-kcal grid as baselineGoal (rounded in computeDynamicBaseline)
    // and the choice-screen preview rows.
    const todaysGoal = Math.round((baselineGoal + bonusApplied) / 5) * 5;

    return {
      stepBonus: Math.round(stepBonus),
      workoutBonus: Math.round(workoutBonus),
      bonusUncapped: Math.round(bonusUncapped),
      bonusApplied: Math.round(bonusApplied),
      capped,
      todaysGoal,
      breakdown: {
        netSteps: Math.round(safeSteps),
        workouts: workoutBreakdown
      }
    };
  }
}

module.exports = new GoalService();
