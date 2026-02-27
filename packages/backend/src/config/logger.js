const winston = require('winston');
const config = require('./environment');

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'imagia-api' },
  transports: [
    new winston.transports.Console({
      format: config.isProduction
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ timestamp, level, message, service, correlationId, ...meta }) => {
              const corrId = correlationId ? ` [${correlationId}]` : '';
              const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
              return `${timestamp} ${level}${corrId}: ${message}${metaStr}`;
            })
          ),
    }),
  ],
});

if (config.isProduction) {
  logger.add(new winston.transports.File({ filename: 'error.log', level: 'error' }));
  logger.add(new winston.transports.File({ filename: 'combined.log' }));
}

module.exports = logger;
