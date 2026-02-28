const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const Sentry = require('@sentry/node');
const config = require('./config/environment');
const logger = require('./config/logger');
const { testConnection } = require('./config/database');
const correlationId = require('./middleware/correlationId');
const metrics = require('./middleware/metrics');
const { apiLimiter } = require('./middleware/rateLimiter');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { clerkAuth } = require('./middleware/auth');

// Routes
const healthRoutes = require('./routes/health');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const conversationRoutes = require('./routes/conversations');
const processingRoutes = require('./routes/processing');
const promptRoutes = require('./routes/prompts');
const analyticsRoutes = require('./routes/analytics');
const secretRoutes = require('./routes/secrets');
const uploadRoutes = require('./routes/uploads');
const deploymentRoutes = require('./routes/deployments');
const githubRoutes = require('./routes/github');
const marketingRoutes = require('./routes/marketing');
const socialRoutes = require('./routes/social');
const domainRoutes = require('./routes/domains');
const modelRoutes = require('./routes/models');

const app = express();

// Trust proxy (Railway runs behind a reverse proxy)
app.set('trust proxy', 1);

// Force HTTPS in production
if (config.isProduction) {
  app.use((req, res, next) => {
    if (req.protocol === 'http') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`);
    }
    next();
  });
}

// Sentry
if (config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: config.nodeEnv,
  });
}

// Security
app.use(helmet({
  contentSecurityPolicy: config.isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://*.clerk.accounts.dev", "https://clerk.imagia.net", "https://static.cloudflareinsights.com"],
      connectSrc: ["'self'", "https://*.clerk.accounts.dev", "https://api.clerk.com", "https://clerk.imagia.net", "https://cloudflareinsights.com"],
      frameSrc: ["'self'", "https://*.clerk.accounts.dev", "https://accounts.imagia.net"],
      imgSrc: ["'self'", "data:", "https://*.clerk.com", "https://img.clerk.com", "https://*.imagia.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'self'", "blob:"],
      fontSrc: ["'self'", "data:"],
    },
  } : false,
}));
app.use(cors({
  origin: [config.frontendUrl, 'http://localhost:5173'],
  credentials: true,
}));

// Body parsing — skip JSON parsing for webhook route (needs raw body for signature verification)
app.use((req, res, next) => {
  if (req.path === '/api/auth/webhook') return next();
  express.json({ limit: '10mb' })(req, res, next);
});
app.use((req, res, next) => {
  if (req.path === '/api/auth/webhook') return next();
  express.urlencoded({ extended: true, limit: '10mb' })(req, res, next);
});

// Custom middleware
app.use(correlationId);
app.use(metrics);

// Clerk auth (adds auth context to all requests)
app.use(clerkAuth);

// Serve uploaded files statically
const path = require('path');
const UPLOAD_DIR = path.resolve(__dirname, '../../../uploads');
app.use('/uploads', express.static(UPLOAD_DIR));

// Rate limiting on API routes
app.use('/api', apiLimiter);

// Routes
app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/processing', processingRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/secrets', secretRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/deployments', deploymentRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/marketing', marketingRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/domains', domainRoutes);
app.use('/api/models', modelRoutes);

// In production, serve the frontend SPA from the built dist/ folder
if (config.isProduction) {
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get('{*path}', (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// Error handling (only reached for API 404s in production, all routes in dev)
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const startServer = async () => {
  await testConnection();

  // Start the hourly usage aggregator
  const usageAggregator = require('./services/usageAggregator');
  usageAggregator.startScheduled();

  app.listen(config.port, () => {
    logger.info(`Imagia API server running on port ${config.port}`, {
      env: config.nodeEnv,
      port: config.port,
    });
  });
};

startServer().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});

module.exports = app;
