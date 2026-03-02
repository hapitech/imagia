const Queue = require('bull');
const config = require('../config/environment');
const logger = require('../config/logger');

const buildQueue = new Queue('imagia:build', config.redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: 50,
    removeOnFail: 100,
    timeout: 10 * 60 * 1000, // 10 minutes (multi-step pipeline + auto-fix)
  },
});

buildQueue.on('error', (err) => logger.error('Build queue error', { error: err.message }));
buildQueue.on('failed', (job, err) => {
  logger.error('Build job failed', { jobId: job.id, error: err.message, data: job.data });
});
buildQueue.on('completed', (job) => {
  logger.info('Build job completed', { jobId: job.id, projectId: job.data.projectId });
});

module.exports = buildQueue;
