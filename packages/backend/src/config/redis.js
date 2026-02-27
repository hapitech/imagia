const Redis = require('ioredis');
const config = require('./environment');
const logger = require('./logger');

let redisClient = null;

function createRedisClient() {
  if (redisClient) return redisClient;

  redisClient = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 2000);
      logger.warn(`Redis reconnecting, attempt ${times}, delay ${delay}ms`);
      return delay;
    },
  });

  redisClient.on('connect', () => logger.info('Redis connecting'));
  redisClient.on('ready', () => logger.info('Redis ready'));
  redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
  redisClient.on('close', () => logger.warn('Redis connection closed'));
  redisClient.on('reconnecting', () => logger.info('Redis reconnecting'));

  const gracefulShutdown = async () => {
    if (redisClient) {
      logger.info('Closing Redis connection');
      await redisClient.quit();
    }
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  return redisClient;
}

module.exports = { createRedisClient };
