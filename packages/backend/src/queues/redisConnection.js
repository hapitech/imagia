const { createRedisClient } = require('../config/redis');

// Shared Redis client for Bull queues
const redisClient = createRedisClient();

module.exports = redisClient;
