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
          .select('_id text subtext type options sequence image')
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
        const planCreationQuestionIds = [
          '6908fe66896ccf24778c9075', // Choose your gender (sequence 4)
          '6908fe66896ccf24778c9076', // How many workouts do you do per week? (sequence 5)
          '6908fe66896ccf24778c9077', // What's your typical day like? (sequence 6)
          '6908fe66896ccf24778c9079', // What's your height and weight? (sequence 8)
          '6908fe66896ccf24778c907a', // What's your date of birth? (sequence 9)
          '6908fe66896ccf24778c907d', // What is your goal? (sequence 12)
          '6908fe66896ccf24778c907f', // What's your target weight (kg)? (sequence 14)
          '6908fe66896ccf24778c9082', // How fast do you want to reach your goal? (sequence 17)
        ].map(id => new mongoose.Types.ObjectId(id));

        // End questions (always last, in this order)
        const endQuestionIds = [
          '6908fe66896ccf24778c9085', // Time to generate your custom plan! (GOAL_CALCULATION)
          '6908fe66896ccf24778c9086', // Congratulations your custom plan is ready! (PLAN_SUMMARY)
        ].map(id => new mongoose.Types.ObjectId(id));

        // Fetch plan creation questions sorted by sequence
        const planQuestions = await Question.find({
          _id: { $in: planCreationQuestionIds },
          isActive: true
        })
          .sort({ sequence: 1 })
          .select('_id text subtext type options sequence image')
          .lean();

        // Fetch end questions
        const endQuestions = await Question.find({
          _id: { $in: endQuestionIds },
          isActive: true
        })
          .sort({ sequence: 1 })
          .select('_id text subtext type options sequence image')
          .lean();

        // Combine: plan questions first, then end questions
        return [...planQuestions, ...endQuestions];
      }
      
      // Default behavior: return all active questions
      return await Question.find({ isActive: true })
        .sort({ sequence: 1 })
        .select('_id text subtext type options sequence image');
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

  // ==================== V2 ENDPOINTS ====================

  /**
   * Returns the full V2 onboarding screen configuration.
   * All screen definitions, options, headers, and metadata.
   */
  static getV2Config() {
    return {
      version: '2.0',
      sections: [
        {
          id: 'your_profile',
          label: 'YOUR PROFILE',
          screens: [
            {
              id: 'screen_1',
              type: 'splash',
              header: null,
              subtext: null,
              ctaText: 'Get Started',
              showProgressBar: false,
              showBackButton: false,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_30',
              type: 'singleSelect',
              header: 'How did you hear about Cal Club?',
              subtext: null,
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'attribution_source',
              footnote: null,
              options: [
                { label: 'Instagram', value: 'instagram' },
                { label: 'YouTube', value: 'youtube' },
                { label: 'A friend or family member', value: 'friend_family' },
                { label: 'My gym / trainer', value: 'gym_trainer' },
                { label: 'An influencer I follow', value: 'influencer' },
                { label: 'App Store', value: 'app_store' },
                { label: 'Other', value: 'other' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_2',
              type: 'textInput',
              header: 'Before we begin, what should we call you?',
              subtext: null,
              ctaText: 'Continue',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: 'user_name',
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_3',
              type: 'infoTransition',
              header: "Let's personalize your Cal Club plan, {name}!",
              subtext: "We'll ask a few quick questions to build something that actually works for you.",
              ctaText: "Let's do it",
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_4',
              type: 'singleSelect',
              header: "What's your main goal?",
              subtext: null,
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'primary_goal',
              footnote: null,
              options: [
                { label: 'Lose fat', value: 'lose_fat' },
                { label: 'Build muscle', value: 'build_muscle' },
                { label: 'Lose fat & build muscle', value: 'recomp' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_5',
              type: 'singleSelect',
              header: "What's your gender?",
              subtext: 'This helps us calculate accurate targets for you.',
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'gender',
              footnote: null,
              options: [
                { label: 'Male', value: 'male' },
                { label: 'Female', value: 'female' },
                { label: 'Other', value: 'other' },
                { label: 'Prefer not to say', value: 'prefer_not_to_say' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_6',
              type: 'datePicker',
              header: 'When were you born?',
              subtext: 'Your age affects your metabolic rate, this helps us set the right targets.',
              ctaText: 'Continue',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: 'date_of_birth',
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_7',
              type: 'dualNumberInput',
              header: "What's your height and weight?",
              subtext: "We'll use this to calculate your BMI and daily calorie needs.",
              ctaText: 'Continue',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: 'height_weight',
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_8',
              type: 'profileSummary',
              header: "Here's your profile, {name}",
              subtext: null,
              ctaText: 'Looks good!',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_9',
              type: 'singleSelect',
              header: 'How would you describe your lifestyle?',
              subtext: 'Your daily routines can affect your results.',
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'lifestyle',
              footnote: null,
              options: [
                { label: 'Student', value: 'student' },
                { label: 'Employed part-time', value: 'employed_part_time' },
                { label: 'Employed full-time', value: 'employed_full_time' },
                { label: 'Not employed', value: 'not_employed' },
                { label: 'Retired', value: 'retired' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'vr_1',
              type: 'valueReinforcement',
              header: '87% of Cal Club users report better progress toward their fitness goals when they track consistently.',
              subtext: null,
              ctaText: 'Continue',
              showProgressBar: false,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: { socialProofNumber: '87%' }
            }
          ]
        },
        {
          id: 'your_goals',
          label: 'YOUR GOALS',
          screens: [
            {
              id: 'screen_10',
              type: 'numberInput',
              header: 'What is your ideal weight that you want to reach?',
              subtext: "Great! We're excited to help you reach your goals.",
              ctaText: 'Next',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: 'target_weight',
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_12',
              type: 'singleSelect',
              header: 'How fast would you like to see results?',
              subtext: "Based on your goal, here's what's realistic and sustainable.",
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'pace_preference',
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: { optionsResolvedByGoal: true }
            },
            {
              id: 'vr_2',
              type: 'valueReinforcement',
              header: 'Sticking to a plan can be hard. Cal Club makes it easy.',
              subtext: null,
              ctaText: 'Got it!',
              showProgressBar: false,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_13',
              type: 'displayAnimation',
              header: null,
              subtext: null,
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_14',
              type: 'infoTransition',
              header: null,
              subtext: null,
              ctaText: 'Continue',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_15',
              type: 'toggleList',
              header: "When do you usually eat? We'll remind you to log.",
              subtext: 'You can always change these later.',
              ctaText: 'Continue',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: 'meal_reminders',
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_16',
              type: 'systemPermission',
              header: null,
              subtext: null,
              ctaText: null,
              showProgressBar: false,
              showBackButton: true,
              autoAdvance: false,
              dataKey: 'notifications_enabled',
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            }
          ]
        },
        {
          id: 'your_journey',
          label: 'YOUR JOURNEY',
          screens: [
            {
              id: 'screen_29',
              type: 'singleSelect',
              header: 'Do you have a gym membership?',
              subtext: null,
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'gym_membership',
              footnote: null,
              options: [
                { label: 'Yes', value: 'yes' },
                { label: 'No, I work out at home or outdoors', value: 'home_outdoor' },
                { label: 'Not right now', value: 'not_now' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_17',
              type: 'singleSelect',
              header: 'How long have you been working out?',
              subtext: 'Any kind of training counts, gym, home workouts, running, sports, anything.',
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'workout_duration',
              footnote: null,
              options: [
                { label: 'Less than a month', value: 'less_than_month' },
                { label: '1\u20133 months', value: '1_3_months' },
                { label: '3\u20136 months', value: '3_6_months' },
                { label: '6 months \u2013 1 year', value: '6_months_1_year' },
                { label: 'Over a year', value: 'over_a_year' },
                { label: 'On and off for a while', value: 'on_and_off' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_18',
              type: 'singleSelect',
              header: "How do you feel about the results you've seen so far?",
              subtext: "Be honest, there's no wrong answer here.",
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'frustration_level',
              footnote: null,
              options: [
                { label: "I'm making good progress but want to optimize", value: 'good_progress' },
                { label: 'Honestly, I expected more by now', value: 'expected_more' },
                { label: "I'm frustrated, I'm putting in the work but not seeing it", value: 'frustrated' },
                { label: "I'm not sure what results to even expect", value: 'unsure' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_19',
              type: 'singleSelect',
              header: 'When it comes to nutrition for your fitness goals, where are you?',
              subtext: null,
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'nutrition_awareness',
              footnote: null,
              options: [
                { label: "I know what to do, I just can't stay consistent", value: 'know_but_inconsistent' },
                { label: "I have a rough idea but I'm not sure it's right", value: 'rough_idea' },
                { label: "Honestly, I'm pretty lost", value: 'pretty_lost' },
                { label: "I've tried tracking before but it didn't stick", value: 'tried_didnt_stick' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_20',
              type: 'singleSelect',
              header: 'Have you tried tracking your food before?',
              subtext: 'Apps, pen and paper, mental tracking, all counts.',
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'tried_tracking',
              footnote: null,
              options: [
                { label: 'Yes', value: 'yes' },
                { label: 'No', value: 'no' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_21',
              type: 'singleSelect',
              header: 'What made you stop?',
              subtext: null,
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'tracking_failure_reason',
              footnote: null,
              options: [
                { label: 'It was too tedious and time-consuming', value: 'too_tedious' },
                { label: "I didn't see the point after a while", value: 'no_point' },
                { label: "I got obsessive about numbers and it wasn't healthy", value: 'obsessive' },
                { label: 'I never really started properly', value: 'never_started' }
              ],
              skipCondition: {
                field: 'tried_tracking',
                operator: 'not_equals',
                value: 'yes',
                skipToScreenId: 'vr_3'
              },
              metadata: {}
            },
            {
              id: 'vr_3',
              type: 'valueReinforcement',
              header: 'WHY CAL CLUB IS DIFFERENT',
              subtext: 'Cal Club creates long-term results through building habits, not crash diets or obsessive tracking.',
              ctaText: 'Continue',
              showProgressBar: false,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_22',
              type: 'singleSelect',
              header: 'Which of these sounds most like you?',
              subtext: null,
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'fitness_identity',
              footnote: null,
              options: [
                { label: "I'm new to fitness and still figuring things out", value: 'new_to_fitness' },
                { label: "I've been at it a while but nutrition has always been my weak spot", value: 'nutrition_weak_spot' },
                { label: "I take my training seriously and I'm ready to dial in the nutrition side", value: 'serious_trainer' },
                { label: "I've been on and off for years and I want this time to be different", value: 'on_off_different' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_23',
              type: 'singleSelect',
              header: "After a day where your eating doesn't go as planned, what usually happens?",
              subtext: null,
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'food_relationship',
              footnote: null,
              options: [
                { label: 'I try to eat less the next day to compensate', value: 'compensate' },
                { label: 'I feel guilty but move on', value: 'guilty_move_on' },
                { label: 'I tend to think "screw it" and eat whatever for a few days', value: 'screw_it' },
                { label: "I don't really think about it much", value: 'dont_think' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_24',
              type: 'multiSelect',
              header: 'What makes sticking to your nutrition hardest?',
              subtext: 'Pick all that apply.',
              ctaText: 'Continue',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: 'nutrition_obstacles',
              footnote: null,
              options: [
                { label: "I eat most meals with family and can't control what's cooked", value: 'family_meals' },
                { label: "I'm busy and end up eating whatever's convenient", value: 'busy_convenience' },
                { label: 'Social situations, dinners, parties, weekends', value: 'social_situations' },
                { label: 'I just don\'t enjoy the food I think I\'m "supposed to" eat', value: 'dont_enjoy' },
                { label: 'I struggle to eat enough to hit my targets', value: 'struggle_enough' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_25',
              type: 'singleSelect',
              header: 'Do you follow a specific diet?',
              subtext: 'This helps us tailor suggestions.',
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'diet_preference',
              footnote: null,
              options: [
                { label: 'Vegetarian', value: 'vegetarian' },
                { label: 'Vegan', value: 'vegan' },
                { label: 'Eggetarian', value: 'eggetarian' },
                { label: 'Non-vegetarian', value: 'non_vegetarian' },
                { label: 'No specific preference', value: 'no_preference' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_26',
              type: 'singleSelect',
              header: "Let's better understand your current state of mind.",
              subtext: 'At this moment, how motivated are you to dial in your nutrition?',
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'motivation_readiness',
              footnote: null,
              options: [
                { label: "I'm ready", value: 'ready' },
                { label: 'Feeling hopeful', value: 'hopeful' },
                { label: "I'm cautious", value: 'cautious' },
                { label: 'Taking it easy', value: 'taking_it_easy' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'vr_4',
              type: 'valueReinforcement',
              header: 'WHAT OUR USERS SAY',
              subtext: null,
              ctaText: 'Got it!',
              showProgressBar: false,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: {
                testimonialQuote: '[Placeholder quote about how the user pushed through a plateau and finally saw the results of their training thanks to dialed-in nutrition]',
                testimonialAttribution: '\u2013 Sarah, Runner'
              }
            }
          ]
        },
        {
          id: 'your_plan',
          label: 'YOUR PLAN',
          screens: [
            {
              id: 'screen_27',
              type: 'singleSelect',
              header: 'If your nutrition was fully dialed in and you were seeing results, what would that change for you?',
              subtext: null,
              ctaText: null,
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: true,
              dataKey: 'motivation_anchor',
              footnote: null,
              options: [
                { label: "I'd finally see my training translate to how I look", value: 'training_results' },
                { label: "I'd feel confident and in control of my body", value: 'confidence' },
                { label: "I'd stop second-guessing every meal", value: 'stop_guessing' },
                { label: "I'd feel like my effort is actually paying off", value: 'effort_paying_off' },
                { label: "I'd perform better in my workouts", value: 'better_performance' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_28',
              type: 'multiSelect',
              header: 'What would you like to accomplish with Cal Club?',
              subtext: 'Pick all that apply.',
              ctaText: 'Continue',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: 'accomplishment_intent',
              footnote: null,
              options: [
                { label: 'Understand what I should be eating', value: 'understand_eating' },
                { label: 'Build consistent nutrition habits', value: 'build_habits' },
                { label: 'Track my food without it feeling like a chore', value: 'track_without_chore' },
                { label: 'Get a plan that works with my training', value: 'plan_works_with_training' },
                { label: 'Stay accountable', value: 'stay_accountable' }
              ],
              skipCondition: null,
              metadata: {}
            },
            {
              id: 'screen_31',
              type: 'infoTransition',
              header: null,
              subtext: null,
              ctaText: 'Build my plan',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: { screenVariant: 'thank_you' }
            },
            {
              id: 'screen_32',
              type: 'infoTransition',
              header: null,
              subtext: null,
              ctaText: 'Continue',
              showProgressBar: true,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: { screenVariant: 'app_store_rating' }
            },
            {
              id: 'screen_33',
              type: 'valueReinforcement',
              header: "Based on everything you've shared, here's how we're going to approach this together.",
              subtext: null,
              ctaText: 'Show me my plan',
              showProgressBar: false,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: { screenVariant: 'convergence' }
            },
            {
              id: 'screen_34',
              type: 'infoTransition',
              header: null,
              subtext: null,
              ctaText: 'Next',
              showProgressBar: false,
              showBackButton: false,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: { screenVariant: 'your_plan' }
            },
            {
              id: 'screen_35',
              type: 'infoTransition',
              header: null,
              subtext: null,
              ctaText: 'Try for $0.00',
              showProgressBar: false,
              showBackButton: false,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: { screenVariant: 'paywall_intro' }
            },
            {
              id: 'screen_36',
              type: 'infoTransition',
              header: null,
              subtext: null,
              ctaText: 'Continue for FREE',
              showProgressBar: false,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: { screenVariant: 'paywall_reminder' }
            },
            {
              id: 'screen_37',
              type: 'infoTransition',
              header: null,
              subtext: null,
              ctaText: 'Start My 3-Day Free Trial',
              showProgressBar: false,
              showBackButton: true,
              autoAdvance: false,
              dataKey: null,
              footnote: null,
              options: null,
              skipCondition: null,
              metadata: { screenVariant: 'paywall_plan', trialDays: 3 }
            }
          ]
        }
      ],
      textMappings: {
        workout_duration: {
          less_than_month: 'less than a month',
          '1_3_months': '1\u20133 months',
          '3_6_months': '3\u20136 months',
          '6_months_1_year': '6 months \u2013 1 year',
          over_a_year: 'over a year',
          on_and_off: 'on and off for a while'
        },
        nutrition_awareness: {
          know_but_inconsistent: 'you know what to do but struggle with consistency',
          rough_idea: "you have a rough idea but aren't sure it's right",
          pretty_lost: "you're still figuring out the nutrition side",
          tried_didnt_stick: "you've tried tracking before but it didn't stick"
        },
        tried_tracking: {
          yes: "you've tracked before",
          no: "you haven't tracked before"
        },
        motivation_anchor: {
          training_results: 'see your training translate to how you look',
          confidence: 'feel confident and in control of your body',
          stop_guessing: 'stop second-guessing every meal',
          effort_paying_off: 'feel like your effort is actually paying off',
          better_performance: 'perform better in your workouts'
        }
      },
      validationRules: {
        user_name: { minLength: 2 },
        height_cm: { min: 50, max: 300 },
        weight_kg: { min: 20, max: 500 },
        target_weight: { min: 30, max: 300 }
      },
      planHighlights: [
        'Focusing on healthy weight loss',
        'Paced to reach your goal and maintain weight loss',
        'AI Nutrition Coach'
      ]
    };
  }

  /**
   * Save V2 onboarding answers and trigger side effects.
   * Reuses existing utility methods for weight logging, name update, etc.
   * @param {string} userId - User ID
   * @param {Object} answers - Flat named-field answers object
   */
  static async saveV2Answers(userId, answers) {
    try {
      const User = require('../models/schemas/User');
      const userIdObjectId = typeof userId === 'string'
        ? new mongoose.Types.ObjectId(userId)
        : userId;

      // Store raw answers in onboarding_v2_answers collection
      const OnboardingV2Answer = this._getV2AnswerModel();

      // Soft delete previous answers
      await OnboardingV2Answer.updateMany(
        { userId: userIdObjectId, deletedAt: null },
        { deletedAt: new Date() }
      );

      // Save new answers
      await OnboardingV2Answer.create({
        userId: userIdObjectId,
        answers: answers,
      });

      // --- Side effects (fire-and-forget, reusing existing methods) ---

      // Update user name
      if (answers.userName) {
        this.updateUserName(userId, answers.userName).catch(err => {
          console.error('V2: Background user name update failed:', err);
        });
      }

      // Update target goal
      if (answers.primaryGoal) {
        this.updateUserTargetGoal(userId, answers.primaryGoal).catch(err => {
          console.error('V2: Background target goal update failed:', err);
        });
      }

      // Update target weight
      if (answers.targetWeight != null) {
        this.updateUserTargetWeight(userId, answers.targetWeight).catch(err => {
          console.error('V2: Background target weight update failed:', err);
        });
      }

      // Auto-log current weight
      if (answers.weightKg != null) {
        const weightAnswer = `weight_${answers.weightKg}`;
        this.autoLogWeight(userId, weightAnswer).catch(err => {
          console.error('V2: Background weight logging failed:', err);
        });
      }

      // Create meal notification preferences
      if (answers.mealReminders && Array.isArray(answers.mealReminders)) {
        const reminderString = answers.mealReminders
          .map(r => `${r.label}:${r.time}:${r.enabled}`)
          .join(',');
        createNotificationPreferencesFromString(userId, reminderString)
          .then(prefs => {
            console.log(`\u2705 V2: Created ${prefs.length} meal notification preferences`);
          })
          .catch(err => {
            console.error('V2: Background notification preference creation failed:', err);
          });
      }

      // Mark onboarding as completed on the user document
      await User.findByIdAndUpdate(
        userIdObjectId,
        {
          onboardingCompleted: true,
          onboardingCompletedAt: new Date()
        },
        { new: true }
      );

      console.log(`\u2705 V2 onboarding completed for user ${userId}`);

      return {
        success: true,
        message: 'Onboarding answers saved successfully'
      };
    } catch (error) {
      throw new Error(`Failed to save V2 answers: ${error.message}`);
    }
  }

  /**
   * Get onboarding completion status for a user.
   * @param {string} userId - User ID
   * @returns {{ completed: boolean }}
   */
  static async getOnboardingStatus(userId) {
    try {
      const User = require('../models/schemas/User');
      const userIdObjectId = typeof userId === 'string'
        ? new mongoose.Types.ObjectId(userId)
        : userId;

      const user = await User.findById(userIdObjectId).select('onboardingCompleted').lean();
      return {
        completed: user?.onboardingCompleted === true
      };
    } catch (error) {
      throw new Error(`Failed to get onboarding status: ${error.message}`);
    }
  }

  /**
   * Lazily create/get the V2 answers Mongoose model.
   * Uses a separate collection: onboarding_v2_answers
   */
  static _getV2AnswerModel() {
    if (mongoose.models.OnboardingV2Answer) {
      return mongoose.models.OnboardingV2Answer;
    }

    const schema = new mongoose.Schema({
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
      },
      answers: {
        type: mongoose.Schema.Types.Mixed,
        required: true
      },
      deletedAt: {
        type: Date,
        default: null
      }
    }, { timestamps: true });

    schema.index({ userId: 1, deletedAt: 1 });

    return mongoose.model('OnboardingV2Answer', schema, 'onboarding_v2_answers');
  }
}

module.exports = OnboardingService;
