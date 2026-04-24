const foodController = require('../controllers/foodController');

const routes = {
  'GET /foods/search': foodController.searchFoods
};

function foodRoutes(req, res) {
  const basePath = req.url.split('?')[0];
  const routeKey = `${req.method} ${basePath}`;
  const handler = routes[routeKey];

  if (handler) {
    handler(req, res);
    return true;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Food route not found' }));
  return true;
}

module.exports = foodRoutes;
