const logger = require('../config/logger');

function metrics(req, res, next) {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      correlationId: req.correlationId,
    };

    if (duration > 5000) {
      logger.warn('Slow request', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
}

module.exports = metrics;
