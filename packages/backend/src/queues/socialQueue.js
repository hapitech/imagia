const Queue = require('bull');
const config = require('../config/environment');

const socialQueue = new Queue('imagia:social', config.redisUrl, {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 50,
    removeOnFail: 100,
    timeout: 2 * 60 * 1000,
  },
});

module.exports = socialQueue;
