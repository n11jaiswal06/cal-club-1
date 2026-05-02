const goalService = require('../services/goalService');
const parseBody = require('../utils/parseBody');
const { reportError } = require('../utils/sentryReporter');

/**
 * Calculate and validate goal targets based on user inputs (v1 - Legacy)
 * POST /goals/calculate
 */
async function calculateGoals(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    console.log('Goal calculation request:', JSON.stringify(body, null, 2));

    // Validate inputs first
    const validation = goalService.validateInputs(body);
    if (!validation.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Invalid input parameters',
        validation: {
          valid: false,
          errors: validation.errors,
          warnings: validation.warnings
        }
      }));
      return;
    }

    // Calculate goals using v1 logic
    const result = goalService.computeTargetsV1(body);

    // Add validation warnings to response if any
    if (validation.warnings.length > 0) {
      result.warnings = validation.warnings;
    }

    console.log('Goal calculation result:', JSON.stringify(result, null, 2));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: result
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error calculating goals:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to calculate goals',
      details: error.message
    }));
  }
}

/**
 * Calculate and validate goal targets using v2 unified energy model
 * POST /goals/calculate-v2
 */
async function calculateGoalsV2(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    console.log('Goal calculation v2 request:', JSON.stringify(body, null, 2));

    // Validate inputs first
    const validation = goalService.validateInputs(body);
    if (!validation.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Invalid input parameters',
        validation: {
          valid: false,
          errors: validation.errors,
          warnings: validation.warnings
        }
      }));
      return;
    }

    // Calculate goals using v2 logic
    const result = goalService.computeTargetsV2(body);

    // Add validation warnings to response if any
    if (validation.warnings.length > 0) {
      result.warnings = [...(result.warnings || []), ...validation.warnings];
    }

    console.log('Goal calculation v2 result:', JSON.stringify(result, null, 2));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: result
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error calculating goals v2:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to calculate goals v2',
      details: error.message
    }));
  }
}

/**
 * Calculate goals using v2 and save to user profile
 * POST /goals/calculate-and-save
 */
async function calculateAndSaveGoals(req, res) {
  try {
    // Extract userId from auth token (set by jwtMiddleware)
    if (!req.user || !req.user.userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Authentication required. Please provide a valid JWT token.'
      }));
      return;
    }

    const userId = req.user.userId;

    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    console.log('Calculate and save goals request:', JSON.stringify(body, null, 2));

    // CAL-36 follow-up: derive age_years from User.dateOfBirth when the
    // payload omits it. PR #53 stopped re-asking DOB on Goal Settings
    // re-entry by filtering the question for users with dateOfBirth on
    // file; the FE can now also stop sending age_years from that flow.
    // Initial onboarding still sends age_years explicitly, so the fallback
    // is intentionally body-wins.
    if (body && (body.age_years === undefined || body.age_years === null)) {
      const User = require('../models/schemas/User');
      const { dobToAgeYears } = require('../services/onboardingService');
      const userDoc = await User.findById(userId).select('dateOfBirth').lean();
      const derived = dobToAgeYears(userDoc && userDoc.dateOfBirth);
      if (derived !== null) {
        body.age_years = derived;
      }
    }

    // Validate inputs first
    const validation = goalService.validateInputs(body);
    if (!validation.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Invalid input parameters',
        validation: {
          valid: false,
          errors: validation.errors,
          warnings: validation.warnings
        }
      }));
      return;
    }

    // Calculate goals using v2 logic
    const result = goalService.computeTargetsV2(body);

    // CAL-22: also compute the BMR×1.2 dynamic baseline so that when
    // mode='dynamic' (or mode='dynamic' + permission-denied fallback) the
    // persisted baselineGoal is the bonus-free baseline that CAL-23's
    // daily-flex math can add activity bonus to without double-counting.
    // computeDynamicBaseline reuses validateInputs-checked fields; same
    // sub-millisecond cost rationale as the resolveGoalMode block below.
    const dynBaseline = goalService.computeDynamicBaseline(body);

    // CAL-23: persist RMR for the daily-flex math (workout bonus needs
    // BMR-during-workout = rmr/1440 × duration). computeDynamicBaseline
    // already returns rmr rounded; pulling from there avoids a redundant
    // calculateRMR call.
    const rmr = dynBaseline.rmr;

    // CAL-21: resolve the dynamic-vs-static mode + outcome combo. Throws on
    // invalid payloads (bad/missing mode, override on mode='static', invalid
    // override value), which we surface as 400. Compute runs unconditionally
    // first; the cost on a rejected payload is sub-millisecond and avoids a
    // sentinel-value pre-validation pass.
    const { mode, outcome: outcomeOverride } = body;
    let resolvedMode;
    try {
      resolvedMode = goalService.resolveGoalMode({
        mode,
        outcome: outcomeOverride,
        calorieTarget: result.calorie_target,
        dynamicBaseline: dynBaseline.baseline
      });
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
      return;
    }

    // Generate goal description. `weightGoalType` is the user's
    // lose/gain/recomp/maintain choice; distinct from `resolvedMode.goalType`
    // ('dynamic'|'static') which describes the home page display variant.
    const weightGoalType = body.goal_type || 'maintain';
    const currentWeight = body.weight_kg;
    const targetWeight = body.desired_weight_kg || currentWeight;
    const pace = Math.abs(body.pace_kg_per_week);

    let goalDescription = '';
    if (weightGoalType === 'lose') {
      const weeksToGoal = Math.ceil(Math.abs(targetWeight - currentWeight) / pace);
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + (weeksToGoal * 7));
      goalDescription = `Lose ${Math.abs(currentWeight - targetWeight).toFixed(1)} kg by ${targetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
    } else if (weightGoalType === 'gain') {
      const weeksToGoal = Math.ceil(Math.abs(targetWeight - currentWeight) / pace);
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + (weeksToGoal * 7));
      goalDescription = `Gain ${Math.abs(targetWeight - currentWeight).toFixed(1)} kg by ${targetDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`;
    } else if (weightGoalType === 'recomp') {
      goalDescription = `Recomp at ${currentWeight} kg`;
    } else {
      goalDescription = `Maintain weight at ${currentWeight} kg`;
    }

    // Save to user profile (CAL-21: write all 9 fields atomically — the 5
    // legacy macro fields plus the 4 dynamic-goal fields).
    const { updateUser } = require('../models/user');
    const updatedUser = await updateUser(userId, {
      'goals.goal': goalDescription,
      'goals.dailyCalories': result.calorie_target,
      'goals.dailyProtein': result.macros.protein_g,
      'goals.dailyCarbs': result.macros.carb_g,
      'goals.dailyFats': result.macros.fat_g,
      'goals.goalType': resolvedMode.goalType,
      'goals.intent': resolvedMode.intent,
      'goals.outcome': resolvedMode.outcome,
      'goals.baselineGoal': resolvedMode.baselineGoal,
      'goals.rmr': rmr
    });

    if (!updatedUser) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'User not found'
      }));
      return;
    }

    // Prepare response with planData. CAL-21: also echo the 4 resolved
    // dynamic-goal fields so the client can render the home variant
    // immediately without an extra GET /users/profile roundtrip.
    const response = {
      success: true,
      data: {
        ...result,
        planData: {
          goal: goalDescription,
          calories: result.calorie_target,
          protein: result.macros.protein_g,
          fat: result.macros.fat_g,
          carbs: result.macros.carb_g
        },
        goalType: resolvedMode.goalType,
        intent: resolvedMode.intent,
        outcome: resolvedMode.outcome,
        baselineGoal: resolvedMode.baselineGoal
      },
      message: 'Goals calculated and saved successfully'
    };

    // Add validation warnings if any
    if (validation.warnings.length > 0) {
      response.data.warnings = [...(result.warnings || []), ...validation.warnings];
    }

    console.log('Goals saved to user profile:', updatedUser.goals);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));

  } catch (error) {
    reportError(error, { req });
    console.error('Error calculating and saving goals:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to calculate and save goals',
      details: error.message
    }));
  }
}

/**
 * CAL-22: Dynamic-vs-Static choice screen preview.
 * POST /goals/choice-preview
 *
 * Read-only — same auth posture as /goals/calculate and /goals/calculate/v2
 * (unauthenticated, exempted in middleware/auth.js). Returns the four
 * personalized numbers the choice screen renders.
 */
async function choicePreview(req, res) {
  try {
    const body = await new Promise((resolve, reject) => {
      parseBody(req, (err, data) => {
        if (err) reject(err);
        else resolve(data);
      });
    });

    console.log('Choice-preview request:', JSON.stringify(body, null, 2));

    const validation = goalService.validateInputs(body);
    if (!validation.valid) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        error: 'Invalid input parameters',
        validation: {
          valid: false,
          errors: validation.errors,
          warnings: validation.warnings
        }
      }));
      return;
    }

    const result = goalService.computeChoicePreview(body);

    if (validation.warnings.length > 0) {
      result.warnings = validation.warnings;
    }

    console.log('Choice-preview result:', JSON.stringify(result, null, 2));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      data: result
    }));

  } catch (error) {
    reportError(error, { req });
    console.error('Error computing choice preview:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: 'Failed to compute choice preview',
      details: error.message
    }));
  }
}

module.exports = {
  calculateGoals,
  calculateGoalsV2,
  calculateAndSaveGoals,
  choicePreview
};
