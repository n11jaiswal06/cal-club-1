/**
 * Simple admin authentication middleware.
 * Checks x-admin-email and x-admin-password headers against env vars.
 */
function adminAuth(req, res, next) {
  const email = req.headers['x-admin-email'];
  const password = req.headers['x-admin-password'];

  if (
    email === process.env.ADMIN_EMAIL &&
    password === process.env.ADMIN_PASSWORD
  ) {
    return next();
  }

  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unauthorized' }));
}

module.exports = adminAuth;
