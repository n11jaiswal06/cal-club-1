const OnboardingController = require('../controllers/onboardingController');

const routes = {
  'GET /onboarding/questions': OnboardingController.getQuestions,
  'POST /onboarding/questions/applicability': OnboardingController.getQuestionsApplicability,
  'POST /onboarding/answers': OnboardingController.saveAnswers,
  'GET /onboarding/answers': OnboardingController.getUserAnswers
};

function onboardingRoutes(req, res) {
  // Extract base path without query parameters
  const basePath = req.url.split('?')[0];
  const routeKey = `${req.method} ${basePath}`;
  const handler = routes[routeKey];

  if (handler) {
    handler(req, res);
    return true;
  }

  // 404 for onboarding routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Onboarding route not found' }));
  return true;
}

module.exports = onboardingRoutes;
