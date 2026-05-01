const goalController = require('../controllers/goalController');

const routes = {
  'POST /goals/calculate': goalController.calculateGoals,
  'POST /goals/calculate/v2': goalController.calculateGoalsV2,
  'POST /goals/calculate-and-save': goalController.calculateAndSaveGoals,
  'POST /goals/choice-preview': goalController.choicePreview
};

function goalRoutes(req, res) {
  // Extract base path without query parameters
  const basePath = req.url.split('?')[0];
  const routeKey = `${req.method} ${basePath}`;
  const handler = routes[routeKey];

  if (handler) {
    handler(req, res);
    return true;
  }

  // 404 for goal routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Goal route not found' }));
  return true;
}

module.exports = goalRoutes;
