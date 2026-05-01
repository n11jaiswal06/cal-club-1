const MealService = require('./mealService');
const HeroBriefService = require('./heroBriefService');
const { buildExerciseBurnContext } = require('./exerciseBurnWidgetService');
const { findUserById } = require('../models/user');
const User = require('../models/schemas/User');
const Question = require('../models/schemas/Question');
const UserQuestion = require('../models/schemas/UserQuestion');
const Membership = require('../models/schemas/Membership');
const { checkMembership } = require('../utils/membershipCheck');
const { validatePhase, getCurrentPhaseIST } = require('../config/heroBriefFallbacks');
const { getTodayDateString } = require('../utils/dateUtils');
const { buildTodaysGoal } = require('./todaysGoalService');

// Interfaces for type consistency
const AppBarData = {
  title: String,
  icon: String,
  caloriesBurnt: Number
};

const DayData = {
  dayLetter: String,
  date: Number,
  isSelected: Boolean
};

const WeekViewData = {
  days: [DayData]
};

const MacroCard = {
  icon: String,
  color: String,
  text: String,
  value: Number,
  completed: Number,
  target: Number
};

const MacroWidget = {
  widgetType: String,
  widgetData: {
    primary_card: MacroCard,
    secondary_cards: [MacroCard]
  }
};

const LogEntry = {
  mealId: String,
  dish_image: String,
  dish_name: String,
  time: String,
  calories: Number,
  protein: Number,
  carbs: Number,
  fat: Number
};

const LoggedWidget = {
  widgetType: String,
  widgetData: {
    title: String,
    subtitle: String,
    logs: [LogEntry],
    zero_state: {
      image: String,
      text: String
    }
  }
};

const FooterItem = {
  active: Boolean,
  icon: String,
  title: String,
  action: String
};

const AppCalendarResponse = {
  appBarData: AppBarData,
  weekViewData: WeekViewData,
  showFloatingActionButton: Boolean,
  widgets: [Object], // MacroWidget | LoggedWidget
  footerData: [FooterItem]
};

class AppFormatService {
  static async getAppCalendarData(userId, date, options = {}) {
    try {
      const { phase: clientPhase = null, regenerate = false } = options;

      // Get the raw calendar data
      const calendarData = await MealService.getCalendarData(userId, date);

      // Get user data for goals
      const user = await findUserById(userId);
      const goals = user?.goals || {
        dailyCalories: 2000,
        dailyProtein: 150,
        dailyCarbs: 250,
        dailyFats: 65
      };

      // Parse the date in IST context
      // If date is a string (YYYY-MM-DD), treat it as IST date
      let currentDate;
      if (typeof date === 'string') {
        const [year, month, day] = date.split('-').map(Number);
        // Create date at noon IST to avoid timezone edge cases
        // IST is UTC+5:30, so noon IST = 06:30 UTC
        currentDate = new Date(Date.UTC(year, month - 1, day, 6, 30, 0, 0));
      } else {
        currentDate = new Date(date);
      }

      // Get day of week in IST
      const istFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short'
      });
      const istDateStr = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(currentDate);
      
      // Parse IST date to get day of week
      const [year, month, day] = istDateStr.split('-').map(Number);
      const istDate = new Date(Date.UTC(year, month - 1, day, 6, 30, 0, 0));
      const currentDayOfWeek = istDate.getUTCDay();
      const daysToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
      
      // Calculate Monday in IST
      const mondayDate = new Date(istDate);
      mondayDate.setUTCDate(mondayDate.getUTCDate() - daysToMonday);
      
      // Calculate today's nutrition totals
      const todayData = this.getTodayNutritionData(calendarData, currentDate);

      // Get today's meals for logged widget
      const todayMeals = await this.getTodayMeals(userId, currentDate);

      // Get membership status for paywall / membership info
      const membershipStatus = await checkMembership(userId);

      // --- Determine if this is a past day ---
      const todayIST = getTodayDateString();
      const isPastDay = date < todayIST;

      // Exercise burn: one query feeds both the hero section's calorie
      // progress bar (goal + burn = effective target) and the
      // exercise_burn_widget rendered below.
      const exerciseBurn = await buildExerciseBurnContext(userId, istDateStr);
      todayData.exerciseBurn = exerciseBurn.totalCalories;

      // --- Hero section ---
      const heroSectionWidget = await this.formatHeroSectionWidget(
        userId, date, todayData, goals, clientPhase, regenerate, isPastDay
      );

      // Format the response
      const widgets = [heroSectionWidget];

      // Add logged widget
      widgets.push(this.formatLoggedWidget(todayMeals));

      // Exercise burn widget (Daily Steps row is always present;
      // workouts appended from ActivityStore EXERCISE category).
      widgets.push(exerciseBurn.widget);

      // Add paywall widget if user does NOT have premium access
      if (!membershipStatus.hasAccess) {
        widgets.push(this.formatPaywallWidget());
      }

      return {
        appBarData: this.formatAppBarData(todayData, goals.dailyCalories),
        weekViewData: this.formatWeekViewData(mondayDate, currentDate),
        daySelectorData: this.formatDaySelectorData(currentDate),
        showFloatingActionButton: true,
        widgets: widgets,
        footerData: this.formatFooterData(),
        membership: {
          isPremium: membershipStatus.isPremium,
          isInTrial: membershipStatus.isInTrial,
          expiresDate: membershipStatus.expiresDate
        }
      };
    } catch (error) {
      throw new Error(`Failed to format app calendar data: ${error.message}`);
    }
  }

  static formatAppBarData(todayData, calorieGoal) {
    const caloriesBurnt = Math.max(0, calorieGoal - todayData.totalCalories);
    
    return {
      title: "Cal Club",
      icon: "fire",
      caloriesBurnt: parseFloat(caloriesBurnt.toFixed(2))
    };
  }

  static formatWeekViewData(mondayDate, currentDate) {
    const days = [];
    const dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    
    // Format current date in IST for comparison
    const currentDateIST = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(currentDate);
    
    for (let i = 0; i < 7; i++) {
      // Calculate day date in IST
      const dayDate = new Date(mondayDate);
      dayDate.setUTCDate(dayDate.getUTCDate() + i);
      
      // Format day date in IST
      const dayDateIST = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(dayDate);
      
      // Get day number in IST
      const dayNumber = parseInt(dayDateIST.split('-')[2]);
      const isSelected = dayDateIST === currentDateIST;
      
      days.push({
        dayLetter: dayLetters[i],
        date: dayNumber,
        isSelected: isSelected
      });
    }
    
    return { days };
  }

  static formatDaySelectorData(currentDate) {
    // Use IST timezone for all date operations
    const istFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    
    // Get today's date in IST
    const now = new Date();
    const todayIST = istFormatter.format(now);
    const todayDate = new Date(todayIST + 'T00:00:00');
    
    // Get yesterday's date in IST
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayIST = istFormatter.format(yesterdayDate);
    
    // Format currentDate in IST
    const dateToCheckIST = istFormatter.format(new Date(currentDate));
    const dateToCheck = new Date(dateToCheckIST + 'T00:00:00');
    
    // Determine dayText
    let dayText;
    if (dateToCheckIST === todayIST) {
      dayText = "TODAY";
    } else if (dateToCheckIST === yesterdayIST) {
      dayText = "YESTERDAY";
    } else {
      // Format as "DD MMM" (e.g., "07 Nov") using IST
      // dateToCheckIST is in YYYY-MM-DD format, parse it directly
      const [year, monthNum, day] = dateToCheckIST.split('-');
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const month = monthNames[parseInt(monthNum) - 1]; // monthNum is 1-12, array is 0-indexed
      dayText = `${day} ${month}`;
    }
    
    // Determine if there's a previous day (always true, can always go back)
    const prev = true;
    
    // Determine if there's a next day (true if current date is not today in IST)
    const next = dateToCheckIST !== todayIST;
    
    // Format date as YYYY-MM-DD (already in IST format)
    const date = dateToCheckIST;
    
    return {
      dayText,
      prev,
      next,
      date
    };
  }

  static formatMacroWidget(todayData, goals) {
    const caloriesLeft = Math.max(0, goals.dailyCalories - todayData.totalCalories);
    const caloriesCompleted = todayData.totalCalories;
    
    return {
      widgetType: "macro_widget",
      widgetData: {
        primary_card: {
          icon: "fire",
          color: "black",
          text: "Calories left",
          value: parseFloat(caloriesLeft.toFixed(2)),
          completed: parseFloat(caloriesCompleted.toFixed(2)),
          target: goals.dailyCalories
        },
        secondary_cards: [
          {
            icon: "lightning",
            color: "red",
            text: "Protein",
            value: parseFloat(todayData.totalProtein.toFixed(2)),
            completed: parseFloat(todayData.totalProtein.toFixed(2)),
            target: goals.dailyProtein
          },
          {
            icon: "wheat",
            color: "brown",
            text: "Carbs",
            value: parseFloat(todayData.totalCarbs.toFixed(2)),
            completed: parseFloat(todayData.totalCarbs.toFixed(2)),
            target: goals.dailyCarbs
          },
          {
            icon: "water",
            color: "blue",
            text: "Fats",
            value: parseFloat(todayData.totalFat.toFixed(2)),
            completed: parseFloat(todayData.totalFat.toFixed(2)),
            target: goals.dailyFats
          }
        ]
      }
    };
  }

  /**
   * Format the hero section widget with LLM guidance text for ALL phases.
   * Returns a single hero_section widget with a `phases` array containing
   * briefs for every available phase, so the client needs only one API call.
   *
   * For past days, returns only the Evening Wrap with no phase tabs.
   */
  static async formatHeroSectionWidget(userId, date, todayData, goals, clientPhase, regenerate, isPastDay) {
    try {
      let showPhaseTabs;
      let activePhaseTabs;
      let phases;

      if (isPastDay) {
        showPhaseTabs = false;
        activePhaseTabs = [];
        // Past days: only evening phase
        const brief = await HeroBriefService.getOrGenerateBrief(userId, date, 'evening', false);
        phases = [{
          phase: brief.phase,
          headline: brief.headline,
          guidanceText: brief.guidanceText
        }];
      } else {
        showPhaseTabs = true;

        // Generate/retrieve the active phase brief (supports regenerate)
        const activePhase = validatePhase(clientPhase);
        const activeBrief = await HeroBriefService.getOrGenerateBrief(userId, date, activePhase, regenerate);

        // Get all available phase tabs (includes cached past phases + current)
        activePhaseTabs = await HeroBriefService.getAvailablePhaseTabs(userId, date);

        // Fetch briefs for past phases in parallel, reuse the active phase brief
        const otherTabs = activePhaseTabs.filter(tab => tab.phase !== activePhase);
        const otherBriefs = await Promise.all(
          otherTabs.map(tab => HeroBriefService.getOrGenerateBrief(userId, date, tab.phase, false))
        );

        // Merge all briefs in tab order
        const briefMap = new Map();
        briefMap.set(activePhase, activeBrief);
        for (const brief of otherBriefs) {
          briefMap.set(brief.phase, brief);
        }

        phases = activePhaseTabs.map(tab => {
          const brief = briefMap.get(tab.phase);
          return { phase: brief.phase, headline: brief.headline, guidanceText: brief.guidanceText };
        });
      }

      // Compute effective target (goal + exercise burn)
      const exerciseBurn = todayData.exerciseBurn || 0;
      const effectiveTarget = goals.dailyCalories + exerciseBurn;

      return {
        widgetType: 'hero_section',
        widgetData: {
          showPhaseTabs,
          activePhaseTabs,
          calories: {
            consumed: parseFloat(todayData.totalCalories.toFixed(2)),
            goal: goals.dailyCalories,
            burn: exerciseBurn,
            effectiveTarget
          },
          protein: {
            consumed: parseFloat(todayData.totalProtein.toFixed(2)),
            goal: goals.dailyProtein
          },
          phases
        }
      };
    } catch (error) {
      console.error('[AppFormatService] Error formatting hero section:', error.message);
      // Return a minimal fallback hero section
      const { PHASE_FALLBACKS, PHASE_HEADLINES, getCurrentPhaseIST } = require('../config/heroBriefFallbacks');
      const fallbackPhase = isPastDay ? 'evening' : getCurrentPhaseIST();
      return {
        widgetType: 'hero_section',
        widgetData: {
          showPhaseTabs: !isPastDay,
          activePhaseTabs: isPastDay ? [] : [{ phase: fallbackPhase, label: 'Now' }],
          calories: {
            consumed: parseFloat((todayData?.totalCalories || 0).toFixed(2)),
            goal: goals?.dailyCalories || 2000,
            burn: 0,
            effectiveTarget: goals?.dailyCalories || 2000
          },
          protein: {
            consumed: parseFloat((todayData?.totalProtein || 0).toFixed(2)),
            goal: goals?.dailyProtein || 150
          },
          phases: [{
            phase: fallbackPhase,
            headline: PHASE_HEADLINES[fallbackPhase],
            guidanceText: PHASE_FALLBACKS[fallbackPhase]
          }]
        }
      };
    }
  }

  static formatLoggedWidget(todayMeals) {
    if (todayMeals.length === 0) {
      return {
        widgetType: "logged_widget",
        widgetData: {
          title: "Today's Logs",
          subtitle: "Here's what you have logged today",
          logs: [],
          zero_state: {
            image: "",
            text: "You have no logs yet"
          }
        }
      };
    }
    
    const logs = todayMeals.map(meal => ({
      mealId: meal._id.toString(),
      dish_image: meal.photos?.[0]?.url || "",
      dish_name: meal.name || "Unknown Meal",
      time: this.formatTime(meal.capturedAt),
      window: this.computeMealWindow(meal.capturedAt),
      calories: parseFloat((meal.totalNutrition?.calories?.final || meal.totalNutrition?.calories?.llm || 0).toFixed(2)),
      protein: parseFloat((meal.totalNutrition?.protein?.final || meal.totalNutrition?.protein?.llm || 0).toFixed(2)),
      carbs: parseFloat((meal.totalNutrition?.carbs?.final || meal.totalNutrition?.carbs?.llm || 0).toFixed(2)),
      fat: parseFloat((meal.totalNutrition?.fat?.final || meal.totalNutrition?.fat?.llm || 0).toFixed(2))
    }));
    
    return {
      widgetType: "logged_widget",
      widgetData: {
        title: "Today's Logs",
        subtitle: "Here's what you have logged today",
        logs: logs,
        zero_state: {
          image: "",
          text: "You have no logs yet"
        }
      }
    };
  }

  /**
   * Format paywall widget shown when user has no active subscription.
   * The client uses this to render the upgrade prompt / paywall overlay.
   */
  static formatPaywallWidget() {
    return {
      widgetType: "paywall_widget",
      widgetData: {
        heading: "Unlock Full Access",
        description: "Track meals, get AI-powered nutrition insights, and reach your health goals.",
        ctaText: "Start Free Trial",
        ctaAction: "navigate_paywall"
      }
    };
  }

  static formatFooterData() {
    return [
      {
        active: true,
        icon: "home",
        title: "Home",
        action: "navigate_home"
      },
      {
        "active": false,
        "icon": "progress",
        "title": "Progress",
        "action": "navigate_progress"
      },
      {
          "active": false,
          "icon": "settings",
          "title": "Settings",
          "action": "navigate_settings"
      }
    ];
  }

  // Helper methods
  static getTodayNutritionData(calendarData, currentDate) {
    const todayString = this.formatDateString(currentDate);
    const todayEntry = calendarData.find(entry => entry.date === todayString);
    
    return {
      totalCalories: todayEntry?.calories || 0,
      totalProtein: todayEntry?.protein || 0,
      totalCarbs: todayEntry?.carbs || 0,
      totalFat: todayEntry?.fat || 0,
      mealCount: todayEntry?.mealCount || 0
    };
  }

  static async getTodayMeals(userId, currentDate) {
    try {
      const todayString = this.formatDateString(currentDate);
      console.log(`[Timezone Debug] Current date: ${currentDate}, Formatted string: ${todayString}`);
      const meals = await MealService.getMeals(userId, { date: todayString });
      console.log(`[Timezone Debug] Found ${meals.length} meals for date: ${todayString}`);
      return meals || [];
    } catch (error) {
      console.error('Failed to fetch today meals:', error);
      return [];
    }
  }

  static formatDateString(date) {
    // Format date in IST timezone
    const d = new Date(date);
    const istFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return istFormatter.format(d);
  }

  static formatTime(date) {
    // Format time in IST timezone
    const d = new Date(date);
    const istFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
    
    const parts = istFormatter.formatToParts(d);
    const hour = parseInt(parts.find(p => p.type === 'hour').value);
    const minute = parts.find(p => p.type === 'minute').value;
    const dayPeriod = parts.find(p => p.type === 'dayPeriod')?.value || '';
    
    return `${hour}:${minute}${dayPeriod}`;
  }

  // Contract: returned strings MUST match the client's allow-list in
  // lib/models/widgets/log_entry_data.dart (_validWindows). Drift silently
  // hides meals on the home page.
  static computeMealWindow(date) {
    const d = new Date(date);
    const istFormatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    });
    const parts = istFormatter.formatToParts(d);
    const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
    const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);

    if (hour >= 5 && hour < 12) return 'Breakfast';
    if (hour >= 12 && hour < 16) return 'Lunch';
    // Snack ends 19:30 IST per meal-planner spec.
    if (hour >= 16 && (hour < 19 || (hour === 19 && minute < 30))) return 'Snack';
    return 'Dinner';
  }

  static isSameDay(date1, date2) {
    // Compare dates in IST timezone
    const date1IST = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date1);
    
    const date2IST = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date2);
    
    return date1IST === date2IST;
  }

  /**
   * Get progress data for user
   * @param {string} userId - User ID
   * @returns {Object} Progress data
   */
  static async getProgressData(userId) {
    try {
      const User = require('../models/schemas/User');
      const UserLog = require('../models/schemas/UserLog');
      const mongoose = require('mongoose');

      // Convert userId to ObjectId if needed
      const userIdObjectId = typeof userId === 'string' 
        ? new mongoose.Types.ObjectId(userId) 
        : userId;

      // Get user data
      const user = await User.findById(userIdObjectId);
      if (!user) {
        throw new Error('User not found');
      }

      // Get weight logs for this user (sorted by date ascending - oldest first)
      const weightLogs = await UserLog.find({
        userId: userIdObjectId,
        type: 'WEIGHT'
      }).sort({ date: 1 }); // Sort ascending: date: 1 means oldest dates first

      // Extract header from goals
      const header = user.goals?.targetGoal || user.goals?.goal || 'Track your progress';

      // Get start and current weight
      let startWeight = null;
      let currentWeight = null;
      let lastCheckedIn = null;
      let graphStartDate = null;
      let graphEndDate = null;
      let currentWeightChange = 0;

      // Format weight history
      const weightHistory = [];
      if (weightLogs.length > 0) {
        // Start weight = oldest entry (first in sorted array)
        const oldestLog = weightLogs[0];
        if (oldestLog && oldestLog.value) {
          startWeight = parseFloat(oldestLog.value);
        }

        // Current weight = latest entry (last in sorted array)
        const latestLog = weightLogs[weightLogs.length - 1];
        if (latestLog && latestLog.value) {
          currentWeight = parseFloat(latestLog.value);
        }
        
        // Last checked in = date of latest weight log
        if (latestLog && latestLog.date && /^\d{4}-\d{2}-\d{2}$/.test(latestLog.date)) {
          lastCheckedIn = latestLog.date; // Already in YYYY-MM-DD format
        }

        // Set graph dates
        if (oldestLog && oldestLog.date && /^\d{4}-\d{2}-\d{2}$/.test(oldestLog.date)) {
          graphStartDate = oldestLog.date;
        }
        if (latestLog && latestLog.date && /^\d{4}-\d{2}-\d{2}$/.test(latestLog.date)) {
          graphEndDate = latestLog.date;
        }

        // Calculate currentWeightChange (difference from previous weight)
        if (weightLogs.length > 1) {
          const previousLog = weightLogs[weightLogs.length - 2];
          if (previousLog && previousLog.value && latestLog && latestLog.value) {
            currentWeightChange = parseFloat((parseFloat(latestLog.value) - parseFloat(previousLog.value)).toFixed(1));
          }
        }

        // Format weight history with labels
        weightLogs.forEach(log => {
          if (log.date && log.value && /^\d{4}-\d{2}-\d{2}$/.test(log.date)) {
            try {
              const date = new Date(log.date + 'T00:00:00');
              if (!isNaN(date.getTime())) {
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                const month = monthNames[date.getMonth()];
                const day = date.getDate();
                const label = `${month} ${day}`;
                
                weightHistory.push({
                  date: log.date,
                  value: parseFloat(log.value),
                  label: label
                });
              }
            } catch (error) {
              console.warn('Error formatting weight history entry:', error);
            }
          }
        });
      }

      // Get target weight from user goals
      const targetWeight = user.goals?.targetWeight || null;

      // Calculate weight change per week
      let weightChangePerWeek = 0;
      if (startWeight && currentWeight && weightLogs.length > 1) {
        try {
          // Parse dates with validation
          const startDateStr = weightLogs[0].date;
          const endDateStr = weightLogs[weightLogs.length - 1].date;
          
          if (startDateStr && endDateStr && /^\d{4}-\d{2}-\d{2}$/.test(startDateStr) && /^\d{4}-\d{2}-\d{2}$/.test(endDateStr)) {
            const startDate = new Date(startDateStr + 'T00:00:00');
            const endDate = new Date(endDateStr + 'T00:00:00');
            
            // Validate dates are valid
            if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
              // Calculate weeks between
              const daysDiff = (endDate - startDate) / (1000 * 60 * 60 * 24);
              const weeksDiff = daysDiff / 7;
              
              if (weeksDiff > 0) {
                weightChangePerWeek = (currentWeight - startWeight) / weeksDiff;
              }
            }
          }
        } catch (error) {
          console.warn('Error calculating weight change per week:', error);
          weightChangePerWeek = 0;
        }
      }

      // Get daily goals from user
      const dailyGoal = {
        calorie: user.goals?.dailyCalories || 2000,
        protein: user.goals?.dailyProtein || 150,
        carbs: user.goals?.dailyCarbs || 250,
        fats: user.goals?.dailyFats || 65
      };

      // Format lastCheckedIn date
      let formattedLastCheckedIn = null;
      if (lastCheckedIn && /^\d{4}-\d{2}-\d{2}$/.test(lastCheckedIn)) {
        try {
          const date = new Date(lastCheckedIn + 'T00:00:00');
          if (!isNaN(date.getTime())) {
            formattedLastCheckedIn = date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            });
          }
        } catch (error) {
          console.warn('Error formatting lastCheckedIn date:', error);
        }
      }

      // Calculate nextCheckIn: max(today IST, lastCheckedIn + 7 days)
      let nextCheckIn = null;
      try {
        const now = new Date();
        const istFormatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Kolkata',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        const todayIST = istFormatter.format(now);

        if (lastCheckedIn && /^\d{4}-\d{2}-\d{2}$/.test(lastCheckedIn)) {
          // Add 7 days to lastCheckedIn
          const lastCheckInDate = new Date(lastCheckedIn + 'T00:00:00');
          if (!isNaN(lastCheckInDate.getTime())) {
            lastCheckInDate.setDate(lastCheckInDate.getDate() + 7);
            const nextCheckInDateStr = istFormatter.format(lastCheckInDate);

            // Compare dates (YYYY-MM-DD format allows string comparison)
            const nextCheckInDate = nextCheckInDateStr > todayIST ? nextCheckInDateStr : todayIST;
            const date = new Date(nextCheckInDate + 'T00:00:00');
            if (!isNaN(date.getTime())) {
              nextCheckIn = date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
              });
            }
          }
        }
        
        // If no lastCheckedIn or error, use today
        if (!nextCheckIn) {
          const date = new Date(todayIST + 'T00:00:00');
          if (!isNaN(date.getTime())) {
            nextCheckIn = date.toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            });
          }
        }
      } catch (error) {
        console.warn('Error calculating nextCheckIn:', error);
        // Fallback to today's date
        try {
          const now = new Date();
          nextCheckIn = now.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          });
        } catch (fallbackError) {
          nextCheckIn = null;
        }
      }

      // Get weekly overview data
      const weeklyOverview = await this.getWeeklyOverviewData(userIdObjectId, dailyGoal.calorie);

      // CAL-23: dynamic-goal block. Returns null for static users or
      // dynamic users missing the cached rmr/baselineGoal (i.e. those who
      // haven't re-saved goals since the CAL-23 rollout). Recomputed
      // lazily on every /app/progress, so /activity-store/sync writes
      // invalidate implicitly without a write-path coupling.
      const dynamicGoal = await buildTodaysGoal(userIdObjectId, getTodayDateString());

      // Footer data (static navigation)
      const footerData = [
        {
          active: false,
          icon: 'home',
          title: 'Home',
          action: 'navigate_home'
        },
        {
          active: true,
          icon: 'progress',
          title: 'Progress',
          action: 'navigate_progress'
        },
        {
          active: false,
          icon: 'settings',
          title: 'Settings',
          action: 'navigate_settings'
        }
      ];

      const response = {
        header,
        weightProgress: {
          startWeight: startWeight || 0,
          currentWeight: currentWeight || 0,
          targetWeight: targetWeight || 0,
          weightChangePerWeek: Math.round(weightChangePerWeek * 10) / 10, // Round to 1 decimal
          graphStartDate: graphStartDate || null,
          graphEndDate: graphEndDate || null,
          weightHistory: weightHistory,
          currentWeightChange: currentWeightChange
        },
        dailyGoal,
        lastCheckedIn: formattedLastCheckedIn,
        nextCheckIn,
        weeklyOverview,
        footerData
      };
      if (dynamicGoal) {
        response.dynamicGoal = dynamicGoal;
      }
      return response;
    } catch (error) {
      throw new Error(`Failed to fetch progress data: ${error.message}`);
    }
  }

  /**
   * Get weekly overview data for progress screen
   * @param {ObjectId} userId - User ID
   * @param {number} dailyCalorieGoal - Daily calorie goal
   * @returns {Object} Weekly overview data
   */
  static async getWeeklyOverviewData(userId, dailyCalorieGoal) {
    try {
      // Get current week (Monday to Sunday) in IST
      const now = new Date();
      const istFormatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      
      // Get today's date in IST
      const todayIST = istFormatter.format(now);
      const [year, month, day] = todayIST.split('-').map(Number);
      const todayDate = new Date(Date.UTC(year, month - 1, day, 6, 30, 0, 0));
      
      // Calculate Monday of current week
      const currentDayOfWeek = todayDate.getUTCDay();
      const daysToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
      const mondayDate = new Date(todayDate);
      mondayDate.setUTCDate(mondayDate.getUTCDate() - daysToMonday);
      
      // Calculate Sunday of current week
      const sundayDate = new Date(mondayDate);
      sundayDate.setUTCDate(sundayDate.getUTCDate() + 6);
      
      // Format dates for query
      const mondayIST = istFormatter.format(mondayDate);
      const sundayIST = istFormatter.format(sundayDate);
      
      // Fetch daily summary for the week
      const dailySummary = await MealService.getDailySummary(userId, mondayIST, sundayIST);
      
      // Create a map of date to calories
      const caloriesMap = {};
      dailySummary.forEach(entry => {
        if (entry.date && entry.calories !== undefined) {
          caloriesMap[entry.date] = entry.calories || 0;
        }
      });
      
      // Build daily data array (Monday to Sunday)
      const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const dailyData = [];
      let totalIntake = 0;
      
      for (let i = 0; i < 7; i++) {
        const dayDate = new Date(mondayDate);
        dayDate.setUTCDate(dayDate.getUTCDate() + i);
        const dayDateIST = istFormatter.format(dayDate);
        
        const intake = caloriesMap[dayDateIST] || 0;
        totalIntake += intake;
        
        dailyData.push({
          day: dayNames[i],
          date: dayDateIST,
          intake: Math.round(intake),
          burned: null, // As per user request
          goalMet: intake <= dailyCalorieGoal
        });
      }
      
      // Calculate average intake (average of all 7 days)
      const avgIntake = Math.round(totalIntake / 7);
      
      return {
        avgIntake: avgIntake,
        avgBurned: null, // As per user request
        dailyGoal: dailyCalorieGoal,
        dailyData: dailyData
      };
    } catch (error) {
      console.warn('Error fetching weekly overview data:', error);
      // Return empty weekly overview on error
      return {
        avgIntake: 0,
        avgBurned: null,
        dailyGoal: dailyCalorieGoal,
        dailyData: []
      };
    }
  }

  /**
   * Get settings data for authenticated user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Settings data object
   */
  static async getSettingsData(userId) {
    try {
      // Fetch user data
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Build header data
      const header = {
        phoneNumber: user.phone || null,
        avatarUrl: null, // Not stored in User schema currently
        email: user.email || null
      };

      // Build menu items
      const menuItems = this.buildMenuItems({});

      // Build footer data
      const footerData = this.buildSettingsFooterData();

      return {
        header,
        menuItems,
        footerData,
        ppUrl: 'https://docs.google.com/document/d/1vMNZFXL72WmHYr1gqaiQkdmylIdS_7JaloBhQ3JINC0/edit?usp=sharing',
        tosUrl: 'https://docs.google.com/document/d/1ZiEeWPyMOGkJuqL3DaUuxsNpcQdyK82sD2gfjce8vMk/edit?usp=sharing'
      };
    } catch (error) {
      console.error('Error building settings data:', error);
      throw error;
    }
  }

  /**
   * Check if user has completed onboarding
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} True if onboarding is complete
   */
  static async checkOnboardingCompletion(userId) {
    try {
      // Get all active questions
      const activeQuestions = await Question.find({ isActive: true })
        .select('_id')
        .lean();

      if (activeQuestions.length === 0) {
        // No active questions means onboarding is "complete" by default
        return true;
      }

      const activeQuestionIds = activeQuestions.map(q => q._id);

      // Get user's answered questions (not deleted)
      const answeredQuestions = await UserQuestion.find({
        userId,
        questionId: { $in: activeQuestionIds },
        deletedAt: null
      })
        .select('questionId')
        .lean();

      const answeredQuestionIds = new Set(
        answeredQuestions.map(aq => aq.questionId.toString())
      );

      // Check if all active questions are answered
      const allAnswered = activeQuestionIds.every(qId =>
        answeredQuestionIds.has(qId.toString())
      );

      return allAnswered;
    } catch (error) {
      console.error('Error checking onboarding completion:', error);
      // Default to incomplete on error
      return false;
    }
  }

  /**
   * Build menu items array for settings screen
   * @param {Object} context - Context data
   * @param {boolean} context.isOnboardingComplete - Whether onboarding is complete
   * @returns {Array} Menu items array
   */
  static buildMenuItems({ isOnboardingComplete }) {
    const menuItems = [];

    // Goal Settings
    menuItems.push({
      id: 'goal_settings',
      icon: 'target',
      title: 'Goal Settings',
      action: 'navigate_goal_settings',
      url: null,
      type: 'navigation',
      color: null,
      showDivider: false,
      subtitle: null
    });

    // Meal Reminders
    menuItems.push({
      id: 'meal_reminders',
      icon: 'notifications',
      title: 'Meal Reminders',
      action: 'navigate_meal_reminders',
      url: null,
      type: 'navigation',
      color: null,
      showDivider: false,
      subtitle: null
    });

    // Subscriptions
    menuItems.push({
      id: 'subscriptions',
      icon: 'subscriptions',
      title: 'Subscriptions',
      action: 'navigate_subscriptions',
      url: null,
      type: 'navigation',
      color: null,
      showDivider: true,
      subtitle: null
    });

    // Apple Health
    menuItems.push({
      id: 'apple_health',
      icon: 'health_and_safety',
      title: 'Apple Health',
      action: 'apple_health',
      url: null,
      type: 'action',
      color: null,
      showDivider: false,
      subtitle: 'Connect to track calories burned'
    });

    return menuItems;
  }

  /**
   * Build footer data array for settings screen
   * @returns {Array} Footer data array
   */
  static buildSettingsFooterData() {
    return [
      {
        active: false,
        icon: 'home',
        title: 'Home',
        action: 'navigate_home'
      },
      {
        active: false,
        icon: 'progress',
        title: 'Progress',
        action: 'navigate_progress'
      },
      {
        active: true,
        icon: 'settings',
        title: 'Settings',
        action: 'navigate_settings'
      }
    ];
  }
}

module.exports = AppFormatService;