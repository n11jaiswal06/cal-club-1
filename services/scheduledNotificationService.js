const cron = require('node-cron');
const { getActivePreferencesByTime } = require('../models/notificationPreference');
const NotificationService = require('./notificationService');
const { reportError } = require('../utils/sentryReporter');

// Meal reminder messages
const REMINDER_MESSAGES = {
  BREAKFAST: {
    title: 'Good morning! 🌅',
    body: "Time to log your breakfast! Start your day by tracking what you eat."
  },
  LUNCH: {
    title: 'Lunch time! 🍽️',
    body: "Don't forget to log your lunch. Stay on track with your nutrition goals!"
  },
  DINNER: {
    title: 'Dinner reminder 🌙',
    body: "Remember to log your dinner. Complete your food diary for today!"
  }
};

/**
 * Get current time in IST (HH:MM format)
 * @returns {string} Current time in HH:MM format
 */
function getCurrentTimeIST() {
  const now = new Date();
  const istFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  
  const formatted = istFormatter.format(now);
  return formatted; // Returns "HH:MM"
}

/**
 * Process meal reminders for a specific time
 * @param {string} time - Time in HH:MM format
 */
async function processMealReminders(time) {
  try {
    // Get all active preferences for this time
    const preferences = await getActivePreferencesByTime(time);
    
    if (preferences.length === 0) {
      return;
    }

    // Process each preference
    for (const pref of preferences) {
      try {
        const message = REMINDER_MESSAGES[pref.type];
        if (!message) {
          continue;
        }

        const result = await NotificationService.sendToUser(
          pref.userId._id || pref.userId,
          message.title,
          message.body,
          {
            type: 'meal_reminder',
            mealType: pref.type,
            scheduledTime: time
          }
        );

        if (result.sentCount > 0) {
          console.log(`✅ [CRON] Successfully sent ${pref.type} reminder to user ${pref.userId} (${result.sentCount} devices) at ${time}`);
        }
      } catch (error) {
        reportError(error, { extra: { userId: pref.userId?.toString(), type: pref.type, time } });
        console.error(`❌ [CRON] Error sending reminder to user ${pref.userId}:`, error.message);
      }
    }
  } catch (error) {
    reportError(error, { extra: { time, context: 'processMealReminders' } });
    console.error(`❌ [CRON] Error processing meal reminders for ${time}:`, error);
  }
}

/**
 * Initialize the cron job for meal reminders
 * Runs every minute to check for scheduled reminders
 */
function initializeMealReminderCron() {
  console.log('🚀 [CRON] Initializing meal reminder cron job...');
  
  // Run every minute for meal reminders
  const mealReminderJob = cron.schedule('* * * * *', async () => {
    const currentTime = getCurrentTimeIST();
    await processMealReminders(currentTime);
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  console.log('✅ [CRON] Meal reminder cron job initialized');

  return { mealReminderJob };
}

/**
 * Manually trigger a test notification for a user
 * @param {string} userId - User ID
 * @param {string} type - BREAKFAST/LUNCH/DINNER
 */
async function sendTestReminder(userId, type) {
  console.log(`\n🧪 [TEST] Sending test ${type} reminder to user: ${userId}`);
  
  const message = REMINDER_MESSAGES[type.toUpperCase()];
  if (!message) {
    console.log(`❌ [TEST] Unknown type: ${type}`);
    return { success: false, error: `Unknown meal type: ${type}` };
  }

  try {
    const result = await NotificationService.sendToUser(
      userId,
      message.title,
      message.body,
      {
        type: 'meal_reminder_test',
        mealType: type.toUpperCase()
      }
    );

    console.log(`🧪 [TEST] Test notification result:`, result);
    return result;
  } catch (error) {
    reportError(error, { extra: { userId, type, context: 'sendTestReminder' } });
    console.error(`❌ [TEST] Error sending test notification:`, error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  initializeMealReminderCron,
  processMealReminders,
  sendTestReminder,
  getCurrentTimeIST,
  REMINDER_MESSAGES
};

