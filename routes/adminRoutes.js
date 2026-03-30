const fs = require('fs');
const path = require('path');
const adminAuth = require('../middleware/adminAuth');
const adminController = require('../controllers/adminController');

function adminRoutes(req, res) {
  const basePath = req.url.split('?')[0];

  // Serve static admin.html at /admin
  if (basePath === '/admin' || basePath === '/admin/') {
    const htmlPath = path.join(__dirname, '..', 'public', 'admin.html');
    fs.readFile(htmlPath, 'utf8', (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Failed to load admin page');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
    });
    return true;
  }

  // API routes — all require admin auth
  if (basePath.startsWith('/admin/api/')) {
    adminAuth(req, res, () => {
      // Route matching
      const routeKey = `${req.method} ${basePath}`;

      // Static routes
      if (routeKey === 'GET /admin/api/stats') {
        return adminController.getStats(req, res);
      }
      if (routeKey === 'GET /admin/api/food-items') {
        return adminController.listFoodItems(req, res);
      }
      if (routeKey === 'POST /admin/api/food-items/bulk-review') {
        return adminController.bulkReview(req, res);
      }
      if (routeKey === 'POST /admin/api/food-items/bulk-delete') {
        return adminController.bulkDelete(req, res);
      }

      // Dynamic routes with :id
      const idMatch = basePath.match(/^\/admin\/api\/food-items\/([a-f0-9]{24})$/);
      if (idMatch) {
        const id = idMatch[1];
        if (req.method === 'GET') return adminController.getFoodItem(req, res, id);
        if (req.method === 'PATCH') return adminController.updateFoodItem(req, res, id);
        if (req.method === 'DELETE') return adminController.deleteFoodItem(req, res, id);
      }

      const reviewedMatch = basePath.match(/^\/admin\/api\/food-items\/([a-f0-9]{24})\/reviewed$/);
      if (reviewedMatch && req.method === 'POST') {
        return adminController.markReviewed(req, res, reviewedMatch[1]);
      }

      // 404 for unmatched admin API routes
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Admin API route not found' }));
    });
    return true;
  }

  // Not an admin route
  return false;
}

module.exports = adminRoutes;
