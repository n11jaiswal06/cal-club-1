const Question = require('../models/schemas/Question');
const UserQuestion = require('../models/schemas/UserQuestion');
const UserLog = require('../models/schemas/UserLog');
const mongoose = require('mongoose');
const { createNotificationPreferencesFromString } = require('../models/notificationPreference');

class OnboardingService {
  /**
   * Extract weight from answer string
   * Supports formats: "weight_60.5" or "height_171&weight_60.5"
   * @param {string} answerString - The answer string
   * @returns {number|null} - Weight in kg or null if not found
   */
  static extractWeightFromAnswer(answerString) {
    if (!answerString || typeof answerString !== 'string') {
      return null;
    }

    // Parse format: "weight_60.5" or "height_171&weight_60.5"
    const weightMatch = answerString.match(/weight_([\d.]+)/i);
    if (weightMatch && weightMatch[1]) {
      const weight = parseFloat(weightMatch[1]);
      return isNaN(weight) ? null : weight;
    }

    return null;
  }

  /**
   * Update user's target weight in goals
   * @param {string} userId - User ID
   * @param {number} weight - Weight value in kg
   */
  static async updateUserTargetWeight(userId, weight) {
    try {
      const User = require('../models/schemas/User');
      
      // Convert userId to ObjectId if it's a string
      const userIdObjectId = typeof userId === 'string' 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;

      const updatedUser = await User.findByIdAndUpdate(
        userIdObjectId,
        { 'goals.targetWeight': weight },
        { new: true }
      );

      if (updatedUser) {
        console.log(`✅ Updated target weight for user ${userId}: ${weight} kg`);
      } else {
        console.warn(`⚠️ User not found: ${userId}`);
      }
    } catch (error) {
      console.error('Error updating user target weight:', error);
      // Don't throw error - this is a background operation
    }
  }

  /**
   * Update user's name from onboarding answer (question 6908fe66896ccf24778c9073)
   * @param {string} userId - User ID
   * @param {string} name - Name value
   */
  static async updateUserName(userId, name) {
    try {
      const User = require('../models/schemas/User');

      const userIdObjectId = typeof userId === 'string'
        ? new mongoose.Types.ObjectId(userId)
        : userId;

      const trimmedName = typeof name === 'string' ? name.trim() : String(name || '');

      const updatedUser = await User.findByIdAndUpdate(
        userIdObjectId,
        { name: trimmedName || null },
        { new: true }
      );

      if (updatedUser) {
        console.log(`✅ Updated name for user ${userId}: ${trimmedName}`);
      } else {
        console.warn(`⚠️ User not found: ${userId}`);
      }
    } catch (error) {
      console.error('Error updating user name:', error);
    }
  }

  /**
   * Update user's target goal in goals
   * @param {string} userId - User ID
   * @param {string} targetGoal - Target goal value
   */
  static async updateUserTargetGoal(userId, targetGoal) {
    try {
      const User = require('../models/schemas/User');
      
      // Convert userId to ObjectId if it's a string
      const userIdObjectId = typeof userId === 'string' 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;

      // Trim and validate the target goal
      const trimmedGoal = typeof targetGoal === 'string' ? targetGoal.trim() : String(targetGoal);

      const updatedUser = await User.findByIdAndUpdate(
        userIdObjectId,
        { 'goals.targetGoal': trimmedGoal },
        { new: true }
      );

      if (updatedUser) {
        console.log(`✅ Updated target goal for user ${userId}: ${trimmedGoal}`);
      } else {
        console.warn(`⚠️ User not found: ${userId}`);
      }
    } catch (error) {
      console.error('Error updating user target goal:', error);
      // Don't throw error - this is a background operation
    }
  }

  /**
   * Auto-log weight to user_logs when height/weight question is answered
   * @param {string} userId - User ID
   * @param {string} answerString - Answer string in format "height_171&weight_60.5"
   */
  static async autoLogWeight(userId, answerString) {
    try {
      const weight = this.extractWeightFromAnswer(answerString);
      
      if (!weight || weight <= 0) {
        console.log('No valid weight found in answer string:', answerString);
        return;
      }

      // Get current date in IST timezone
      const now = new Date();
      const istFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const dateString = istFormatter.format(now);

      // Convert userId to ObjectId if it's a string
      const userIdObjectId = typeof userId === 'string' 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;

      // Check if log already exists for today
      const existingLog = await UserLog.findOne({
        userId: userIdObjectId,
        type: 'WEIGHT',
        date: dateString
      });

      if (existingLog) {
        // Update existing log
        existingLog.value = weight.toString();
        existingLog.unit = 'kg';
        await existingLog.save();
        console.log(`✅ Updated weight log for user ${userId}: ${weight} kg on ${dateString}`);
      } else {
        // Create new log
        const userLog = new UserLog({
          userId: userIdObjectId,
          type: 'WEIGHT',
          value: weight.toString(),
          unit: 'kg',
          date: dateString
        });
        await userLog.save();
        console.log(`✅ Created weight log for user ${userId}: ${weight} kg on ${dateString}`);
      }
    } catch (error) {
      console.error('Error auto-logging weight:', error);
      // Don't throw error - this is a background operation
    }
  }

  static async getActiveQuestions(type = null) {
    try {
      // If type is "NOTIFICATIONS", return only the meal timing question
      if (type === 'NOTIFICATIONS') {
        const notificationQuestionId = new mongoose.Types.ObjectId('6908fe66896ccf24778c9087');
        
        const question = await Question.findOne({
          _id: notificationQuestionId,
          isActive: true
        })
          .select('_id text subtext type options sequence image infoScreen choicePreview healthPermissionPriming dataImport skipIf')
          .lean();
        
        return question ? [question] : [];
      }

      // If type is "PLAN_CREATION", return only questions needed for plan creation
      if (type === 'PLAN_CREATION') {
        // Question IDs for plan creation data:
        // sex_at_birth: Choose your gender
        // age_years: What's your date of birth?
        // height_cm, weight_kg: What's your height and weight?
        // goal_type: What is your goal?
        // pace_kg_per_week: How fast do you want to reach your goal?
        // activity_level: What's your typical day like?
        // workouts_per_week: How many workouts do you do per week?
        // desired_weight_kg: What's your target weight (kg)?
        // CAL-19: drop the deprecated SLIDER rate question and include the
        // three CAL-18 server-driven questions (loss-rate, gain-rate, recomp
        // info) so the Goal Settings sub-flow surfaces the new payload.
        // Skipping is governed by each question's `skipIf` rules; the bloc
        // walks them in `lib/blocs/onboarding/onboarding_skip_logic.dart`.
        //
        // Lookup strategy:
        //   - `_id`-pinned for questions whose IDs are stable across DBs:
        //       * the original demographic seed (6908fe…) — same _id on every
        //         deployment because the dev/staging/prod DBs were seeded
        //         from a shared dump.
        //       * CAL-24 (69f43ca2…) — pinned by the migration's upsert filter,
        //         so the IDs in scripts/migrate_onboarding_cal24.js match
        //         every DB the migration runs against.
        //   - `sequence`-pinned for CAL-18 rate questions: their migration
        //     upserts on `{ sequence: X.Y }`, so every DB minted its own
        //     `_id`s. Looking them up by _id silently dropped them from this
        //     chain on any DB but the one a developer happened to seed first.
        //     Sequence is the migration's actual canonical key, so we use it.
        const stableQuestionIds = [
          '6908fe66896ccf24778c9075', // Choose your gender
          '6908fe66896ccf24778c9076', // How many workouts do you do per week?
          '6908fe66896ccf24778c9077', // What's your typical day like?
          '6908fe66896ccf24778c9079', // What's your height and weight?
          '6908fe66896ccf24778c907a', // What's your date of birth?
          '6908fe66896ccf24778c907d', // What's your primary goal? (CAL-18)
          '6908fe66896ccf24778c907f', // What's your target weight (kg)? (skipIf maintain)
          // CAL-24: Dynamic Goal screens. Pinned _ids match the upsert filters
          // in scripts/migrate_onboarding_cal24.js. Branching is governed by
          // each question's skipIf rule against the choice question (14.1).
          '69f43ca240000000000000a1', // Dynamic-vs-Static choice (CHOICE_PREVIEW) — CAL-24
          '69f43ca240000000000000a3', // Health permission priming (skipIf static) — CAL-24
          '69f43ca240000000000000a5', // Data import status (skipIf static) — CAL-24
        ].map(id => new mongoose.Types.ObjectId(id));

        // CAL-18 rate questions — pinned by sequence, not _id. See note above.
        const cal18RateSequences = [13.3, 13.5, 13.7];

        // End questions (always last, in this order)
        const endQuestionIds = [
          '6908fe66896ccf24778c9085', // Time to generate your custom plan! (GOAL_CALCULATION)
          '6908fe66896ccf24778c9086', // Congratulations your custom plan is ready! (PLAN_SUMMARY)
        ].map(id => new mongoose.Types.ObjectId(id));

        // Fetch plan creation questions in a single query — _id-pinned and
        // sequence-pinned together — sorted by sequence so the chain is
        // contiguous regardless of which lookup matched each row.
        const planQuestions = await Question.find({
          $or: [
            { _id: { $in: stableQuestionIds } },
            { sequence: { $in: cal18RateSequences } },
          ],
          isActive: true,
        })
          .sort({ sequence: 1 })
          .select('_id text subtext type options sequence image infoScreen choicePreview healthPermissionPriming dataImport skipIf')
          .lean();

        // Fetch end questions
        const endQuestions = await Question.find({
          _id: { $in: endQuestionIds },
          isActive: true
        })
          .sort({ sequence: 1 })
          .select('_id text subtext type options sequence image infoScreen choicePreview healthPermissionPriming dataImport skipIf')
          .lean();

        // Combine: plan questions first, then end questions
        return [...planQuestions, ...endQuestions];
      }
      
      // Default behavior: return all active questions
      return await Question.find({ isActive: true })
        .sort({ sequence: 1 })
        .select('_id text subtext type options sequence image infoScreen choicePreview healthPermissionPriming dataImport skipIf');
    } catch (error) {
      throw new Error(`Failed to fetch active questions: ${error.message}`);
    }
  }

  static async saveUserAnswers(answers) {
    try {
      if (!Array.isArray(answers) || answers.length === 0) {
        throw new Error('Answers must be a non-empty array');
      }

      // Validate each answer
      for (const answer of answers) {
        if (!answer.userId || !answer.questionId || !answer.values || !Array.isArray(answer.values)) {
          throw new Error('Each answer must have userId, questionId, and values array');
        }
      }

      // Extract unique userIds and questionIds for bulk operations
      const userIds = [...new Set(answers.map(a => a.userId))];
      const questionIds = [...new Set(answers.map(a => a.questionId))];
      
      // Bulk soft delete existing answers for all user-question combinations
      if (userIds.length > 0 && questionIds.length > 0) {
        await UserQuestion.updateMany(
          { 
            userId: { $in: userIds },
            questionId: { $in: questionIds },
            deletedAt: null 
          },
          { deletedAt: new Date() }
        );
      }
      
      // Bulk create new answers
      const newAnswers = answers.map(answer => ({
        userId: answer.userId,
        questionId: answer.questionId,
        values: answer.values
      }));
      
      const savedAnswers = await UserQuestion.insertMany(newAnswers);
      const results = savedAnswers.map(answer => ({ action: 'created', answer }));

      // Auto-log weight if weight logging question is answered (questionId: 6908fe66896ccf24778c9079)
      const WEIGHT_LOG_QUESTION_ID = '6908fe66896ccf24778c9079';
      const weightLogAnswer = answers.find(answer => {
        const questionIdStr = answer.questionId?.toString();
        return questionIdStr === WEIGHT_LOG_QUESTION_ID;
      });

      if (weightLogAnswer && weightLogAnswer.values && weightLogAnswer.values.length > 0) {
        // Extract answer string from values array (usually first element)
        const answerString = weightLogAnswer.values[0];
        if (answerString && typeof answerString === 'string') {
          // Auto-log weight in background (don't await to avoid blocking response)
          this.autoLogWeight(weightLogAnswer.userId, answerString).catch(err => {
            console.error('Background weight logging failed:', err);
          });
        }
      }

      // Update target weight if height/weight question is answered (questionId: 6908fe66896ccf24778c907f)
      const TARGET_WEIGHT_QUESTION_ID = '6908fe66896ccf24778c907f';
      const targetWeightAnswer = answers.find(answer => {
        const questionIdStr = answer.questionId?.toString();
        return questionIdStr === TARGET_WEIGHT_QUESTION_ID;
      });

      if (targetWeightAnswer && targetWeightAnswer.values && targetWeightAnswer.values.length > 0) {
        // Extract answer string from values array (usually first element)
        const answerString = targetWeightAnswer.values[0];
        if (answerString && typeof answerString === 'string') {
          // Extract weight from answer string
          const weight = this.extractWeightFromAnswer(answerString);
          
          if (weight && weight > 0) {
            // Update user's target weight in goals
            this.updateUserTargetWeight(targetWeightAnswer.userId, weight).catch(err => {
              console.error('Background target weight update failed:', err);
            });
          }
        }
      }

      // Update target goal if goal question is answered
      const TARGET_GOAL_QUESTION_ID = '6908fe66896ccf24778c907d';
      const targetGoalAnswer = answers.find(answer => {
        const questionIdStr = answer.questionId?.toString();
        return questionIdStr === TARGET_GOAL_QUESTION_ID;
      });

      if (targetGoalAnswer && targetGoalAnswer.values && targetGoalAnswer.values.length > 0) {
        // Extract answer value from values array (usually first element)
        const goalValue = targetGoalAnswer.values[0];
        if (goalValue !== null && goalValue !== undefined) {
          // Convert to string if needed and update target goal
          const goalString = typeof goalValue === 'string' ? goalValue : String(goalValue);
          
          if (goalString.trim()) {
            // Update user's target goal in background (don't await to avoid blocking response)
            this.updateUserTargetGoal(targetGoalAnswer.userId, goalString).catch(err => {
              console.error('Background target goal update failed:', err);
            });
          }
        }
      }

      // Set user name when name question is answered (questionId: 6908fe66896ccf24778c9073)
      const NAME_QUESTION_ID = '6908fe66896ccf24778c9073';
      const nameAnswer = answers.find(answer => {
        const questionIdStr = answer.questionId?.toString();
        return questionIdStr === NAME_QUESTION_ID;
      });

      if (nameAnswer && nameAnswer.values && nameAnswer.values.length > 0) {
        const nameValue = nameAnswer.values[0];
        if (nameValue !== null && nameValue !== undefined) {
          const nameString = typeof nameValue === 'string' ? nameValue : String(nameValue);
          if (nameString.trim()) {
            this.updateUserName(nameAnswer.userId, nameString).catch(err => {
              console.error('Background user name update failed:', err);
            });
          }
        }
      }

      // Handle meal notification preferences question
      const MEAL_NOTIFICATION_QUESTION_ID = '6908fe66896ccf24778c9087';
      const mealNotificationAnswer = answers.find(answer => {
        const questionIdStr = answer.questionId?.toString();
        return questionIdStr === MEAL_NOTIFICATION_QUESTION_ID;
      });

      if (mealNotificationAnswer && mealNotificationAnswer.values && mealNotificationAnswer.values.length > 0) {
        // Extract answer string from values array (first element)
        // Format: "Morning:08:00 AM:true,Lunch:01:00 PM:false,Dinner:07:00 PM:false"
        const reminderString = mealNotificationAnswer.values[0];
        if (reminderString && typeof reminderString === 'string') {
          console.log('🔔 [ONBOARDING] Processing meal notification preferences...');
          console.log('🔔 [ONBOARDING] User:', mealNotificationAnswer.userId);
          console.log('🔔 [ONBOARDING] Reminder string:', reminderString);
          
          // Create notification preferences in background (don't await to avoid blocking response)
          createNotificationPreferencesFromString(mealNotificationAnswer.userId, reminderString)
            .then(prefs => {
              console.log(`✅ [ONBOARDING] Created ${prefs.length} meal notification preferences`);
            })
            .catch(err => {
              console.error('❌ [ONBOARDING] Background notification preference creation failed:', err);
            });
        }
      }

      return {
        success: true,
        message: `Successfully processed ${results.length} answers`,
        results
      };
    } catch (error) {
      throw new Error(`Failed to save user answers: ${error.message}`);
    }
  }

  static async getUserAnswers(userId) {
    try {
      return await UserQuestion.find({ userId, deletedAt: null })
        .populate('questionId', 'text subtext type options sequence')
        .sort({ 'questionId.sequence': 1 });
    } catch (error) {
      throw new Error(`Failed to fetch user answers: ${error.message}`);
    }
  }

  static async deleteAllAnswersForUser(userId) {
    try {
      return await UserQuestion.updateMany(
        { userId, deletedAt: null },
        { deletedAt: new Date() }
      );
    } catch (error) {
      throw new Error(`Failed to delete user answers: ${error.message}`);
    }
  }
}

module.exports = OnboardingService;
