const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: false, // Optional to support email / social logins
    trim: true,
    validate: {
      validator: function(v) {
        // Allow empty / undefined, enforce format only when present
        if (!v) return true;
        return /^\+?[1-9]\d{1,14}$/.test(v);
      },
      message: props => `${props.value} is not a valid phone number!`
    }
  },
  name: {
    type: String,
    trim: true,
    maxlength: 100
  },
  email: {
    type: String,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email!`
    }
  },
  // CAL-36: User date of birth, captured from the onboarding DOB question
  // (Question _id 6908fe66896ccf24778c907a) and persisted here so the Goal
  // Settings sub-flow can suppress the DOB ask when re-entered from
  // Profile. Backfilled from existing UserQuestion answers by
  // scripts/migrate_user_dob_cal36.js.
  dateOfBirth: {
    type: Date
  },
  goals: {
    goal: {
      type: String,
      trim: true,
      maxlength: 200
    },
    targetGoal: {
      type: String,
      trim: true,
      maxlength: 200
    },
    targetWeight: {
      type: Number,
      min: 0,
      max: 500
    },
    dailyCalories: {
      type: Number,
      min: 0,
      max: 10000,
      default: 2000
    },
    dailyProtein: {
      type: Number,
      min: 0,
      max: 1000,
      default: 150
    },
    dailyCarbs: {
      type: Number,
      min: 0,
      max: 2000,
      default: 250
    },
    dailyFats: {
      type: Number,
      min: 0,
      max: 500,
      default: 65
    },
    // CAL-21: Dynamic Goal data model. These four fields are calculated
    // outputs of POST /goals/calculate-and-save and are deliberately not
    // user-editable via PATCH /users/profile — see allowedGoalFields in
    // controllers/userController.js.
    //
    // - goalType: what was actually applied for the home page display variant.
    // - intent:   what the user originally chose at the picker. Stays
    //             'dynamic' even if outcome falls back to static, so a future
    //             "re-enable Dynamic" prompt can target intent=dynamic AND
    //             outcome != 'dynamic'.
    // - outcome:  why the chosen mode was/wasn't applied (success or fallback
    //             reason).
    // - baselineGoal: the persisted Dynamic baseline calorie target. Mirrors
    //             dailyCalories at save time and does NOT change daily; the
    //             daily flex is computed elsewhere from this baseline.
    goalType: {
      type: String,
      enum: ['dynamic', 'static']
    },
    intent: {
      type: String,
      enum: ['dynamic', 'static']
    },
    outcome: {
      type: String,
      enum: ['dynamic', 'static_chosen', 'static_permission_denied', 'static_sync_failed']
    },
    baselineGoal: {
      type: Number,
      min: 0,
      max: 10000
    },
    // CAL-23: cached Mifflin-St Jeor RMR (kcal/day) at goal-save time.
    // Demographics (sex/age/height) live in UserQuestion answers and are
    // not directly indexable by name from the User doc, so we persist the
    // already-computed RMR here for the daily-flex math (workout bonus
    // subtracts BMR-during-workout = rmr/1440 × duration). Refreshed on
    // every /goals/calculate-and-save; users who haven't re-saved goals
    // post-rollout simply won't see the dynamicGoal block until they do.
    rmr: {
      type: Number,
      min: 0,
      max: 10000
    },
    // CAL-44: dynamic-macros recipe. For dynamic users, daily macros are
    // recomputed per-render from this recipe + todaysGoal so carbs absorb
    // the activity bonus and protein/fat stay coherent with the moving
    // calorie ceiling. Static users leave these undefined and continue to
    // render the flat dailyProtein/dailyFats/dailyCarbs above.
    //
    // - weightKg: snapshot at goal-save. Re-derived only on the next
    //   /goals/calculate-and-save — not refreshed against the latest
    //   UserLog WEIGHT entry per render. Bodyweight drift between saves
    //   is acceptable; the ticket calls protein "invariant modulo
    //   bodyweight changes."
    // - weightGoalType: lose/maintain/gain/recomp. Distinct from goalType
    //   above ('dynamic'/'static'); naming overlap is the same one already
    //   called out in the CAL-21 comment block.
    // - proteinGramsPerKg / fatPctFloor / fatGramsPerKgFloor: the three
    //   coefficients that drove the original calculateAdaptiveMacros math
    //   for this user. Persisting them — instead of just goal_type — keeps
    //   the per-day path self-contained and lets us tune the table without
    //   having to recompute every dynamic user.
    weightKg: {
      type: Number,
      min: 0,
      max: 500
    },
    weightGoalType: {
      type: String,
      enum: ['lose', 'maintain', 'gain', 'recomp']
    },
    proteinGramsPerKg: {
      type: Number,
      min: 0,
      max: 5
    },
    fatPctFloor: {
      type: Number,
      min: 0,
      max: 1
    },
    fatGramsPerKgFloor: {
      type: Number,
      min: 0,
      max: 5,
      default: 0.6
    }
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLoginAt: {
    type: Date
  },
  firebaseUid: {
    type: String,
    unique: true,
    sparse: true, // Allows null values but enforces uniqueness when present
    trim: true
  }
}, {
  timestamps: true
});

// Indexes
userSchema.index({ phone: 1 });
userSchema.index({ email: 1 });
userSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', userSchema, 'users'); 