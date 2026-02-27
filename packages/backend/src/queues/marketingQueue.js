const Queue = require('bull');
const config = require('../config/environment');
const logger = require('../config/logger');

const marketingQueue = new Queue('imagia:marketing', config.redisUrl, {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 50,
    removeOnFail: 100,
    timeout: 5 * 60 * 1000,
  },
});

marketingQueue.on('error', (err) => logger.error('Marketing queue error', { error: err.message }));
marketingQueue.on('failed', (job, err) => {
  logger.error('Marketing job failed', { jobId: job.id, error: err.message });
});

module.exports = marketingQueue;
