require('dotenv').config();
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENV || 'prod',
  tracesSampleRate: typeof process.env.SENTRY_TRACES_SAMPLE_RATE !== 'undefined'
    ? parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE, 10)
    : 0.1,
});

const http = require('http');
const jwtMiddleware = require('./middleware/auth');
const { attachMembershipStatus } = require('./middleware/membership');
const setupRoutes = require('./routes/index');
const { connectToMongo } = require('./config/db');
const { initializeMealReminderCron, getCurrentTimeIST } = require('./services/scheduledNotificationService');
const { initializeHeroBriefCron } = require('./services/heroBriefCron');
const { initializeFoodItemRefinementCron } = require('./services/foodItemRefinementCron');

const PORT = process.env.PORT || 3000;
const { reportError } = require('./utils/sentryReporter');

process.on('unhandledRejection', (reason, promise) => {
  reportError(reason instanceof Error ? reason : new Error(String(reason)));
  console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  reportError(err);
  console.error('Uncaught Exception:', err);
});

const server = http.createServer(async (req, res) => {
  const path = req.url?.split('?')[0] || req.url || '/';
  const transactionName = `${req.method || 'GET'} ${path}`;

  Sentry.startSpanManual(
    {
      name: transactionName,
      op: 'http.server',
      forceTransaction: true,
      attributes: {
        'http.request.method': req.method,
        'url.path': path,
      },
    },
    (span) => {
      let ended = false;
      const endSpan = () => {
        if (ended || !span || typeof span.end !== 'function') return;
        ended = true;
        try {
          Sentry.setHttpStatus(span, res.statusCode || 500);
        } catch (_) {}
        span.end();
      };
      res.once('finish', endSpan);
      res.once('close', endSpan);

      try {
        jwtMiddleware(req, res, () => {
          // Attach membership status to req.user (non-blocking)
          attachMembershipStatus(req, res, () => {
            try {
              setupRoutes(req, res);
            } catch (err) {
              reportError(err, { req });
              console.error('Route error:', err);
              if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Internal server error', details: err.message }));
              }
            }
          });
        });
      } catch (err) {
        reportError(err, { req });
        console.error('Request error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error', details: err.message }));
        }
      }
    }
  );
});

connectToMongo().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
    console.log(`Current IST time: ${getCurrentTimeIST()}`);
    
    // Initialize cron jobs
    initializeMealReminderCron();
    initializeHeroBriefCron();
    initializeFoodItemRefinementCron();
  });
}); 