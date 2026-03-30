const aiController = require('../controllers/aiController');

const routes = {
  'POST /ai/food-calories': aiController.foodCalories,
  'POST /ai/food-calories-v2': aiController.foodCaloriesV2,
  'POST /ai/food-calories-v3': aiController.foodCaloriesV3,
  'POST /ai/food-calories-v4': aiController.foodCaloriesV4
};

function aiRoutes(req, res) {
  // Extract base path without query parameters
  const basePath = req.url.split('?')[0];
  const routeKey = `${req.method} ${basePath}`;
  const handler = routes[routeKey];

  if (handler) {
    handler(req, res);
    return true;
  }

  // 404 for AI routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'AI route not found' }));
  return true;
}

module.exports = aiRoutes; 