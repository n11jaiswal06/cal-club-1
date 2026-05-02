const Question = require('../models/schemas/Question');
const UserQuestion = require('../models/schemas/UserQuestion');
const UserLog = require('../models/schemas/UserLog');
const mongoose = require('mongoose');
const { createNotificationPreferencesFromString } = require('../models/notificationPreference');
const { validateTargetWeight } = require('./targetWeightValidator');

// CAL-33: structured 422 error for cross-field onboarding validation. The
// onboarding controller serializes `errors` (and the matching server-driven
// copy) so the FE can render targeted helper text per field/code instead of
// a flat string.
class OnboardingValidationError extends Error {
  constructor(errors) {
    super('Onboarding answers failed validation');
    this.name = 'OnboardingValidationError';
    this.errors = Array.isArray(errors) ? errors : [];
  }
}

// Canonical question identities used by CAL-33 cross-field validation.
// CAL-30 introduced slugs as the stable identity; the pinned hexes here
// are kept ONLY as a fallback for long-lived envs that minted the
// canonical _ids during the original CAL-9 seed and may not yet have
// run scripts/backfill_question_slugs.js.
//
// resolveCanonicalQuestionIds() resolves all three slugs in one query
// and returns the actual `_id`s present in the connected DB. The
// validator uses the resolved ids to match incoming answer payloads,
// not the pinned hexes — so on a fresh deploy where slug-pinning ran
// but the canonical hex was never minted, the FE's slug-derived
// questionId still matches.
const CANONICAL_SLUG_TO_PINNED_ID = Object.freeze({
  target_weight: '6908fe66896ccf24778c907f',
  height_weight: '6908fe66896ccf24778c9079',
  goal_type: '6908fe66896ccf24778c907d',
  date_of_birth: '6908fe66896ccf24778c907a'
});

// CAL-36: pinned DOB question id. Used by the DOB-capture side-effect in
// saveUserAnswers, by the PLAN_CREATION filter in getActiveQuestions, and
// by the backfill migration / tests (re-exported below).
const DOB_QUESTION_ID = CANONICAL_SLUG_TO_PINNED_ID.date_of_birth;
const MIN_DOB_YEAR = 1900;

// CAL-36: parse a raw DOB answer value into a Date, or null if it can't be
// parsed or the year is outside MIN_DOB_YEAR..currentYear. Shared between
// the runtime side-effect (updateUserDateOfBirth) and the backfill
// migration so both apply the exact same validation.
function parseDob(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  if (year < MIN_DOB_YEAR || year > currentYear) return null;
  return parsed;
}

// CAL-36 follow-up: derive completed years from a DOB to feed goalService
// (which validates `age_years` 13..80). Returns null on a falsy/unparseable
// input so the caller can fall back to the request body or surface a
// missing-field error. UTC math throughout to match parseDob.
function dobToAgeYears(dob) {
  if (!dob) return null;
  const d = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const beforeBirthdayThisYear =
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate());
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

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
   * CAL-36: Persist the onboarding DOB answer onto User.dateOfBirth so the
   * Goal Settings sub-flow can suppress the DOB ask on Profile re-entry.
   * Background side-effect of saveUserAnswers — failures are logged and
   * swallowed (matches updateUserName / updateUserTargetWeight). The DOB
   * question (id 6908fe66896ccf24778c907a) is type=DATE; values[0] is
   * typically an ISO date string from the FE date picker. Anything
   * `new Date()` can't parse, or a year outside 1900..currentYear, is
   * rejected without touching the User doc.
   * @param {string} userId
   * @param {string|number|Date} dobValue
   */
  static async updateUserDateOfBirth(userId, dobValue) {
    try {
      const User = require('../models/schemas/User');

      const parsed = parseDob(dobValue);
      if (!parsed) {
        // PII: don't log dobValue itself.
        console.warn(`⚠️ Skipping DOB update for user ${userId}: unparseable or out-of-range value`);
        return;
      }

      const userIdObjectId = typeof userId === 'string'
        ? new mongoose.Types.ObjectId(userId)
        : userId;

      const updatedUser = await User.findByIdAndUpdate(
        userIdObjectId,
        { dateOfBirth: parsed },
        { new: true }
      );

      if (updatedUser) {
        console.log(`✅ Updated dateOfBirth for user ${userId}`);
      } else {
        console.warn(`⚠️ User not found: ${userId}`);
      }
    } catch (error) {
      console.error('Error updating user dateOfBirth:', error);
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

  static async getActiveQuestions(type = null, userId = null) {
    try {
      // If type is "NOTIFICATIONS", return only the meal timing question
      if (type === 'NOTIFICATIONS') {
        const notificationQuestionId = new mongoose.Types.ObjectId('6908fe66896ccf24778c9087');
        
        const question = await Question.findOne({
          _id: notificationQuestionId,
          isActive: true
        })
          .select('_id slug text subtext type options sequence image infoScreen choicePreview healthPermissionPriming dataImport skipIf validation')
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
          // CAL-35: '6908fe66896ccf24778c9076' (workouts/week) is now isActive:false
          // — standard activity multipliers bake exercise into the band, so a
          // separate workouts question would double-count. Removed from the
          // chain entirely; the migration deactivates the row.
          '6908fe66896ccf24778c9077', // What's your typical activity level? (CAL-35; was "typical day")
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
          .select('_id slug text subtext type options sequence image infoScreen choicePreview healthPermissionPriming dataImport skipIf validation')
          .lean();

        // Fetch end questions
        const endQuestions = await Question.find({
          _id: { $in: endQuestionIds },
          isActive: true
        })
          .sort({ sequence: 1 })
          .select('_id slug text subtext type options sequence image infoScreen choicePreview healthPermissionPriming dataImport skipIf validation')
          .lean();

        // Combine: plan questions first, then end questions
        let combined = [...planQuestions, ...endQuestions];

        // CAL-36: when an authenticated user re-enters Goal Settings from
        // Profile, drop the DOB question if we already have it on file.
        // Anonymous (initial onboarding) callers always see the full list
        // because userId is null until sign-up completes. Single cheap
        // lookup; only on PLAN_CREATION; only when authenticated.
        if (userId) {
          const User = require('../models/schemas/User');
          const user = await User.findById(userId).select('dateOfBirth').lean();
          if (user && user.dateOfBirth) {
            combined = combined.filter(q => String(q._id) !== DOB_QUESTION_ID);
          }
        }

        return combined;
      }
      
      // Default behavior: return all active questions
      return await Question.find({ isActive: true })
        .sort({ sequence: 1 })
        .select('_id slug text subtext type options sequence image infoScreen choicePreview healthPermissionPriming dataImport skipIf validation');
    } catch (error) {
      throw new Error(`Failed to fetch active questions: ${error.message}`);
    }
  }

  // CAL-33: resolve canonical question _ids by slug in a single query,
  // falling back to the pinned hex when the slug isn't set on the doc.
  // Returns a map of { slug → ObjectId-string } so the validator matches
  // incoming answer payloads against the actual `_id` present in this
  // DB, not a hardcoded hex that may not have been minted on a fresh
  // deploy. Pinned hexes only fire when the slug backfill (CAL-30) has
  // not yet run on the connected DB.
  static async resolveCanonicalQuestionIds() {
    const slugs = Object.keys(CANONICAL_SLUG_TO_PINNED_ID);
    const docs = await Question.find({ slug: { $in: slugs } })
      .select('_id slug validation')
      .lean();

    const out = {};
    const validationMap = {};
    for (const slug of slugs) {
      const bySlug = docs.find(d => d.slug === slug);
      if (bySlug) {
        out[slug] = String(bySlug._id);
        validationMap[slug] = bySlug.validation || null;
      } else {
        out[slug] = CANONICAL_SLUG_TO_PINNED_ID[slug];
      }
    }
    return { ids: out, validation: validationMap };
  }

  // CAL-33: cross-field validation of submitted target weight against the
  // user's goal direction and current weight. Runs BEFORE persisting any
  // UserQuestion rows so a 422 is returned without partial writes. When
  // the target-weight question isn't in the payload, this is a no-op.
  //
  // Resolution order for the two cross-field inputs:
  //   • goal value: prefer the goal-type answer in the same payload; fall
  //     back to the user's most recent UserQuestion answer for that
  //     question. Onboarding submits answers question-by-question, so the
  //     stored prior answer is the realistic source.
  //   • current weight: prefer the height/weight answer in the same
  //     payload; fall back to the most recent UserLog WEIGHT entry, then
  //     the most recent height/weight UserQuestion answer.
  //
  // The Question.validation payload (set by the CAL-33 migration) carries
  // the absolute bounds, the minDeltaKg, and the server-driven copy keyed
  // by error code. The validator returns a list of structured errors; the
  // caller throws OnboardingValidationError to surface a 422.
  static async validateTargetWeightAnswer(answers, resolved) {
    // `resolved` is the output of resolveCanonicalQuestionIds() shared
    // with saveUserAnswers's downstream side-effect blocks (target-weight
    // persistence). Falls back to a fresh lookup when called directly.
    const { ids, validation: validationMap } = resolved || (await this.resolveCanonicalQuestionIds());

    const targetAnswer = answers.find(a => String(a.questionId) === ids.target_weight);
    if (!targetAnswer || !Array.isArray(targetAnswer.values) || targetAnswer.values.length === 0) {
      return;
    }
    const targetString = targetAnswer.values[0];
    if (typeof targetString !== 'string') return;
    // extractWeightFromAnswer returns null when the regex doesn't match
    // (truly malformed payload) and a number otherwise — including 0 and
    // negatives, which the validator catches as INVALID_NUMBER. Only the
    // null case is a no-op for the validator; numeric values flow through.
    const targetKg = this.extractWeightFromAnswer(targetString);
    if (targetKg === null) return;

    const validation = validationMap.target_weight;
    if (!validation) {
      // No validation payload seeded yet — nothing to enforce. Migration
      // hasn't run, so we err on the side of accepting the answer rather
      // than blocking onboarding.
      return;
    }

    const userId = targetAnswer.userId;
    const [goalValue, currentKg] = await Promise.all([
      this.resolveGoalValue(userId, answers, ids.goal_type),
      this.resolveCurrentWeightKg(userId, answers, ids.height_weight)
    ]);

    const result = validateTargetWeight({ targetKg, currentKg, goalValue, validation });
    if (!result.valid) {
      throw new OnboardingValidationError(result.errors);
    }
  }

  static async resolveGoalValue(userId, answers, goalQuestionId) {
    const inPayload = answers.find(a => String(a.questionId) === goalQuestionId);
    if (inPayload && Array.isArray(inPayload.values) && inPayload.values.length > 0) {
      const v = inPayload.values[0];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    const prior = await UserQuestion.findOne({
      userId,
      questionId: new mongoose.Types.ObjectId(goalQuestionId),
      deletedAt: null
    }).sort({ createdAt: -1 }).select('values').lean();
    const v = prior?.values?.[0];
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  }

  static async resolveCurrentWeightKg(userId, answers, heightWeightQuestionId) {
    const inPayload = answers.find(a => String(a.questionId) === heightWeightQuestionId);
    if (inPayload && Array.isArray(inPayload.values) && inPayload.values.length > 0) {
      const w = this.extractWeightFromAnswer(inPayload.values[0]);
      if (w) return w;
    }
    const userIdObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    const log = await UserLog.findOne({ userId: userIdObjectId, type: 'WEIGHT' })
      .sort({ date: -1 })
      .select('value')
      .lean();
    const fromLog = log ? parseFloat(log.value) : NaN;
    if (Number.isFinite(fromLog) && fromLog > 0) return fromLog;
    const priorAnswer = await UserQuestion.findOne({
      userId: userIdObjectId,
      questionId: new mongoose.Types.ObjectId(heightWeightQuestionId),
      deletedAt: null
    }).sort({ createdAt: -1 }).select('values').lean();
    const fromQuestion = priorAnswer?.values?.[0];
    if (typeof fromQuestion === 'string') {
      const w = this.extractWeightFromAnswer(fromQuestion);
      if (w) return w;
    }
    return null;
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

      // CAL-33: resolve canonical question _ids by slug ONCE per save
      // so both the validator and the target-weight side-effect block
      // below match incoming payloads against the actual `_id`s in
      // this DB (not pinned hexes that may not have been minted on a
      // fresh deploy). Other side-effect blocks (NAME / TARGET_GOAL /
      // MEAL_NOTIFICATION / WEIGHT_LOG) still use the pinned hex —
      // tracked as a follow-up; behavior is unchanged from pre-PR.
      const canonical = await this.resolveCanonicalQuestionIds();

      // CAL-33: cross-field validation must run BEFORE any persistence so
      // that a 422 leaves the DB untouched. OnboardingValidationError
      // propagates to the controller and serializes as a structured 422.
      await this.validateTargetWeightAnswer(answers, canonical);

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

      // Update target weight if target-weight question is answered.
      // Validation already ran in validateTargetWeightAnswer above; this
      // path is the persistence-side effect (User.goals.targetWeight).
      // Uses the slug-resolved `_id` so it matches the same answer the
      // validator gated.
      const targetWeightAnswer = answers.find(answer => {
        const questionIdStr = answer.questionId?.toString();
        return questionIdStr === canonical.ids.target_weight;
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

      // CAL-36: persist DOB answer to User.dateOfBirth so the Goal Settings
      // sub-flow can suppress the DOB ask on Profile re-entry. Same
      // fire-and-forget posture as the NAME / TARGET_WEIGHT blocks above.
      // DOB_QUESTION_ID is declared at module scope (used by the
      // PLAN_CREATION filter in getActiveQuestions too).
      const dobAnswer = answers.find(answer => {
        const questionIdStr = answer.questionId?.toString();
        return questionIdStr === DOB_QUESTION_ID;
      });

      if (dobAnswer && dobAnswer.values && dobAnswer.values.length > 0) {
        const dobValue = dobAnswer.values[0];
        if (dobValue !== null && dobValue !== undefined && dobValue !== '') {
          this.updateUserDateOfBirth(dobAnswer.userId, dobValue).catch(err => {
            console.error('Background user dateOfBirth update failed:', err);
          });
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
      // CAL-33: structured validation errors must propagate as-is so the
      // controller can map them to 422 with field/code/message. Wrapping
      // in a generic Error would lose the structure.
      if (error instanceof OnboardingValidationError) throw error;
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
module.exports.OnboardingValidationError = OnboardingValidationError;
module.exports.DOB_QUESTION_ID = DOB_QUESTION_ID;
module.exports.MIN_DOB_YEAR = MIN_DOB_YEAR;
module.exports.parseDob = parseDob;
module.exports.dobToAgeYears = dobToAgeYears;
