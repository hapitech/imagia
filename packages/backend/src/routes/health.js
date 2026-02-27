const express = require('express');
const { db } = require('../config/database');
const { createRedisClient } = require('../config/redis');

const router = express.Router();

router.get('/', async (req, res) => {
  const services = {
    postgresql: 'error',
    redis: 'error',
  };

  try {
    await db.raw('SELECT 1');
    services.postgresql = 'ok';
  } catch (err) {
    // leave as error
  }

  try {
    const redisClient = createRedisClient();
    await redisClient.ping();
    services.redis = 'ok';
  } catch (err) {
    // leave as error
  }

  const allOk = Object.values(services).every((s) => s === 'ok');
  const statusCode = allOk ? 200 : 503;

  res.status(statusCode).json({
    status: allOk ? 'ok' : 'degraded',
    services,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
