const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

function jwtMiddleware(req, res, next) {
  if (
    (req.url === '/auth/request-otp' || req.url === '/auth/verify-otp' || req.url === '/auth/firebase/verify-token') &&
    req.method === 'POST'
  ) {
    return next();
  }
  
  // Allow public access to onboarding questions
  if (req.url === '/onboarding/questions' && req.method === 'GET') {
    return next();
  }

  // CAL-32: stateless skipIf evaluator runs pre-auth (sign-up comes after
  // onboarding). The client carries answers in the request body; the server
  // reads no per-user state.
  if (req.url === '/onboarding/questions/applicability' && req.method === 'POST') {
    return next();
  }
  
      // Allow unauthenticated access to webhook endpoints
      if (req.url.startsWith('/webhooks/') && req.method === 'POST') {
        return next();
      }

      // Allow unauthenticated access to goal calculation endpoints (read-only)
      // But require auth for calculate-and-save since it modifies user data
      if (req.url.startsWith('/goals/') && !req.url.includes('/calculate-and-save')) {
    return next();
  }
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }));
    return;
  }
  const token = authHeader.split(' ')[1];
           try {
           const decoded = jwt.verify(token, JWT_SECRET);
           req.user = decoded; // Contains userId
           next();
         } catch (err) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid or expired token' }));
  }
}

module.exports = jwtMiddleware; 