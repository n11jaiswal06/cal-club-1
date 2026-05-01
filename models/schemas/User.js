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