const Sentry = require('@sentry/node');
const logger = require('../config/logger');
const config = require('../config/environment');

function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
}

function errorHandler(err, req, res, _next) {
  const correlationId = req.correlationId || 'unknown';

  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    correlationId,
    method: req.method,
    path: req.originalUrl,
  });

  if (config.isProduction) {
    Sentry.captureException(err, {
      tags: { correlationId },
      user: req.auth ? { id: req.auth.userId } : undefined,
    });
  }

  // Joi validation errors
  if (err.isJoi || err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      message: err.message,
      correlationId,
    });
  }

  // Clerk auth errors
  if (err.status === 401 || err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
      correlationId,
    });
  }

  // Rate limit errors
  if (err.status === 429) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      correlationId,
    });
  }

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: 'Internal Server Error',
    message: config.isProduction ? 'An unexpected error occurred' : err.message,
    correlationId,
  });
}

module.exports = { notFoundHandler, errorHandler };
