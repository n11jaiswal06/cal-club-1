const authRoutes = require('./authRoutes');
const aiRoutes = require('./aiRoutes');
const testRoutes = require('./testRoutes');
const mealRoutes = require('./mealRoutes');
const userRoutes = require('./userRoutes');
const appRoutes = require('./appRoutes');
const onboardingRoutes = require('./onboardingRoutes');
const subscriptionRoutes = require('./subscriptionRoutes');
const webhookRoutes = require('./webhookRoutes');
const goalRoutes = require('./goalRoutes');
const userLogRoutes = require('./userLogRoutes');
const notificationRoutes = require('./notificationRoutes');
const { requireAccess } = require('../middleware/membership');
const activityStoreRoutes = require('./activityStoreRoutes');
const exerciseRoutes = require('./exerciseRoutes');

function setupRoutes(req, res) {
  const url = req.url;
  const method = req.method;

  // ── Public routes (no premium required) ──

  // Auth routes
  if (url.startsWith('/auth/')) {
    return authRoutes(req, res);
  }

  // Test routes
  if (url.startsWith('/test')) {
    return testRoutes(req, res);
  }

  // Onboarding routes
  if (url.startsWith('/onboarding')) {
    return onboardingRoutes(req, res);
  }

  // Subscription / Plans / Memberships routes (need to be accessible for purchasing)
  if (url.startsWith('/subscriptions') || url.startsWith('/plans') || url.startsWith('/memberships')) {
    return subscriptionRoutes(req, res);
  }

  // Webhook routes (no auth needed)
  if (url.startsWith('/webhooks')) {
    return webhookRoutes(req, res);
  }

  // Notification routes (push token registration etc.)
  if (url.startsWith('/notifications')) {
    return notificationRoutes(req, res);
  }

  // App routes (calendar, home page -- always accessible so paywall widget can render)
  if (url.startsWith('/app')) {
    return appRoutes(req, res);
  }

  // User routes (profile -- accessible for paywall display)
  if (url.startsWith('/users')) {
    return userRoutes(req, res);
  }

  // ── Premium routes (require active trial or paid subscription) ──

  // AI routes
  if (url.startsWith('/ai/')) {
    return requireAccess(req, res, () => aiRoutes(req, res));
  }

  // Meal routes
  if (url.startsWith('/meals')) {
    return requireAccess(req, res, () => mealRoutes(req, res));
  }

  // Goal calculation routes
  if (url.startsWith('/goals')) {
    return requireAccess(req, res, () => goalRoutes(req, res));
  }

  // User log routes
  if (url.startsWith('/user-logs')) {
    return requireAccess(req, res, () => userLogRoutes(req, res));
  }

  // Activity store (sync / fetch)
  if (url.startsWith('/activity-store')) {
    return activityStoreRoutes(req, res);
  }

  // Exercise logging routes
  if (url.startsWith('/api/exercise')) {
    return exerciseRoutes(req, res);
  }

  // Default 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Route not found' }));
  return true;
}

module.exports = setupRoutes; 