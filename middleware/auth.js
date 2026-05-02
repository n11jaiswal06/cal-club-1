const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

function jwtMiddleware(req, res, next) {
  if (
    (req.url === '/auth/request-otp' || req.url === '/auth/verify-otp' || req.url === '/auth/firebase/verify-token') &&
    req.method === 'POST'
  ) {
    return next();
  }
  
  // Onboarding question fetch must remain accessible during sign-up (no
  // JWT yet), but Profile re-entry into Goal Settings sends a JWT so the
  // controller can drop already-answered questions (CAL-36: DOB). Decode
  // the token if present, attach req.user on success, fall through to
  // next() otherwise — invalid/missing token is treated as anonymous.
  if (req.url.split('?')[0] === '/onboarding/questions' && req.method === 'GET') {
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
      } catch (_) {
        // Anonymous fallback.
      }
    }
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
      // But require auth for calculate-and-save since it modifies user data.
      // CAL-36 follow-up: same posture as /onboarding/questions — decode the
      // JWT if present so /goals/choice-preview can fall back to
      // User.dateOfBirth when Goal Settings re-entry stops sending age_years.
      // Anonymous (initial onboarding) callers still go through.
      if (req.url.startsWith('/goals/') && !req.url.includes('/calculate-and-save')) {
        const authHeader = req.headers['authorization'];
        if (authHeader && authHeader.startsWith('Bearer ')) {
          try {
            req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
          } catch (_) {
            // Anonymous fallback.
          }
        }
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