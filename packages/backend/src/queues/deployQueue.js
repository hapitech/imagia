const Queue = require('bull');
const config = require('../config/environment');
const logger = require('../config/logger');

const deployQueue = new Queue('imagia:deploy', config.redisUrl, {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 100,
    timeout: 10 * 60 * 1000, // 10 minutes
  },
});

deployQueue.on('error', (err) => logger.error('Deploy queue error', { error: err.message }));
deployQueue.on('failed', (job, err) => {
  logger.error('Deploy job failed', { jobId: job.id, error: err.message });
});

module.exports = deployQueue;
