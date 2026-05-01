const userController = require('../controllers/userController');

const routes = {
  'GET /users/profile': userController.getUserProfile,
  'PATCH /users/profile': userController.updateUserProfile,
  'DELETE /users': userController.deleteUser
};

function userRoutes(req, res) {
  // Extract base path without query parameters
  const basePath = req.url.split('?')[0];
  const routeKey = `${req.method} ${basePath}`;
  const handler = routes[routeKey];

  if (handler) {
    handler(req, res);
    return true;
  }

  // 404 for user routes
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'User route not found' }));
  return true;
}

module.exports = userRoutes; 