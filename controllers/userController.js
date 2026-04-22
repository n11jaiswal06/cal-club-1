const { updateUser } = require('../models/user');
const parseBody = require('../utils/parseBody');
const { reportError } = require('../utils/sentryReporter');

function updateUserProfile(req, res) {
  parseBody(req, async (err, updateData) => {
    if (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }

    // Only allow updating specific fields for security
    const allowedFields = ['name', 'email'];
    const allowedGoalFields = ['goal', 'targetGoal', 'targetWeight', 'dailyCalories', 'dailyProtein', 'dailyCarbs', 'dailyFats'];
    const filteredData = {};
    
    // Handle top-level fields
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        filteredData[field] = updateData[field];
      }
    }

    // Handle goals fields separately - use dot notation to update only provided fields
    if (updateData.goals && typeof updateData.goals === 'object') {
      // Validate goals if provided
      const validationErrors = validateGoals(updateData.goals);
      if (validationErrors.length > 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid goals data', details: validationErrors }));
        return;
      }

      // Build dot notation updates for goals fields
      for (const field of allowedGoalFields) {
        if (updateData.goals[field] !== undefined) {
          filteredData[`goals.${field}`] = updateData.goals[field];
        }
      }
    }

    // Validate email if provided
    if (filteredData.email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(filteredData.email)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid email format' }));
        return;
      }
    }

    try {
      const updatedUser = await updateUser(req.user.userId, filteredData);
      if (!updatedUser) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'User not found' }));
        return;
      }

      // Return only safe fields (exclude sensitive data)
      const safeUserData = {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        goals: updatedUser.goals,
        isActive: updatedUser.isActive,
        lastLoginAt: updatedUser.lastLoginAt,
        updatedAt: updatedUser.updatedAt
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(safeUserData));
    } catch (error) {
      reportError(error, { req });
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to update user', details: error.message }));
    }
  });
}

/**
 * DELETE /users
 *
 * Deactivates the caller's own account. The user is identified from the
 * authenticated Bearer token (`req.user.userId`), not from request body —
 * this lets OAuth-only users (Google / Apple) trigger deletion even though
 * they have no phone number on file, and prevents one user from passing
 * another's identifier in the body.
 *
 * Side effects on the target user:
 *   - `isActive` flipped to false
 *   - `firebaseUid` cleared so the sparse-unique index releases the slot
 *     and the next Google/Apple sign-in can create a fresh record
 *   - onboarding answers + meals soft-deleted
 *   - active auth token revoked
 */
async function deleteUser(req, res) {
  try {
    const userId = req.user && req.user.userId;
    if (!userId) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }

    const {
      deactivateUserById,
      findUserById,
      revokeAuthToken,
    } = require('../models/user');
    const OnboardingService = require('../services/onboardingService');
    const MealService = require('../services/mealService');

    const existing = await findUserById(userId);
    if (!existing || !existing.isActive) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'User not found or already deactivated' }));
      return;
    }

    const deactivated = await deactivateUserById(userId);
    if (!deactivated) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to deactivate user' }));
      return;
    }

    await OnboardingService.deleteAllAnswersForUser(userId);
    await MealService.deleteAllMealsForUser(userId);
    await revokeAuthToken(userId);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'User deactivated successfully and all related data soft deleted',
      userId: String(userId),
      isActive: false,
    }));
  } catch (error) {
    reportError(error, { req });
    console.error('Error deactivating user:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Failed to deactivate user',
      details: error.message,
    }));
  }
}

function validateGoals(goals) {
  const errors = [];
  
  if (goals.goal !== undefined) {
    if (typeof goals.goal !== 'string' || goals.goal.length > 200) {
      errors.push('goal must be a string with max 200 characters');
    }
  }
  
  if (goals.targetGoal !== undefined) {
    if (typeof goals.targetGoal !== 'string' || goals.targetGoal.length > 200) {
      errors.push('targetGoal must be a string with max 200 characters');
    }
  }
  
  if (goals.targetWeight !== undefined) {
    if (typeof goals.targetWeight !== 'number' || goals.targetWeight < 0 || goals.targetWeight > 500) {
      errors.push('targetWeight must be a number between 0 and 500');
    }
  }
  
  if (goals.dailyCalories !== undefined) {
    if (typeof goals.dailyCalories !== 'number' || goals.dailyCalories < 0 || goals.dailyCalories > 10000) {
      errors.push('dailyCalories must be a number between 0 and 10,000');
    }
  }
  
  if (goals.dailyProtein !== undefined) {
    if (typeof goals.dailyProtein !== 'number' || goals.dailyProtein < 0 || goals.dailyProtein > 1000) {
      errors.push('dailyProtein must be a number between 0 and 1,000');
    }
  }
  
  if (goals.dailyCarbs !== undefined) {
    if (typeof goals.dailyCarbs !== 'number' || goals.dailyCarbs < 0 || goals.dailyCarbs > 2000) {
      errors.push('dailyCarbs must be a number between 0 and 2,000');
    }
  }
  
  if (goals.dailyFats !== undefined) {
    if (typeof goals.dailyFats !== 'number' || goals.dailyFats < 0 || goals.dailyFats > 500) {
      errors.push('dailyFats must be a number between 0 and 500');
    }
  }
  
  return errors;
}

module.exports = { 
  updateUserProfile,
  deleteUser
}; 