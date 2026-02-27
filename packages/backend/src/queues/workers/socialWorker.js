/**
 * Social Worker
 *
 * Bull queue processor for social media posting jobs.
 * Handles scheduled post publishing and engagement polling.
 *
 * Can run as a standalone process:
 *   node packages/backend/src/queues/workers/socialWorker.js
 */

const Queue = require('bull');
const config = require('../../config/environment');
const logger = require('../../config/logger');
const { db } = require('../../config/database');
const socialService = require('../../services/socialService');

const socialQueue = new Queue('imagia:social', config.redisUrl, {
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 50,
    removeOnFail: 100,
    timeout: 2 * 60 * 1000,
  },
});

// ---------- Job processors -----------------------------------------------------

socialQueue.process('publish', 3, async (job) => {
  const { postId } = job.data;
  logger.info('Social publish job started', { jobId: job.id, postId });

  try {
    const result = await socialService.publishPost(postId);
    logger.info('Social post published successfully', { postId, result });
    return { success: true, postId, ...result };
  } catch (err) {
    logger.error('Social publish failed', { postId, error: err.message });

    // Mark post as failed
    await db('scheduled_posts').where({ id: postId }).update({
      status: 'failed',
      error_message: err.message,
      updated_at: db.fn.now(),
    });

    throw err;
  }
});

socialQueue.process('fetch-engagement', 5, async (job) => {
  const { postId } = job.data;
  logger.info('Engagement fetch job started', { jobId: job.id, postId });

  try {
    const engagement = await socialService.fetchEngagement(postId);
    return { success: true, postId, engagement };
  } catch (err) {
    logger.error('Engagement fetch failed', { postId, error: err.message });
    throw err;
  }
});

socialQueue.process('check-scheduled', 1, async (job) => {
  logger.info('Checking for scheduled posts ready to publish');

  try {
    const now = new Date().toISOString();
    const duePostIds = await db('scheduled_posts')
      .where({ status: 'scheduled' })
      .where('scheduled_at', '<=', now)
      .pluck('id');

    if (duePostIds.length === 0) {
      return { success: true, queued: 0 };
    }

    logger.info(`Found ${duePostIds.length} scheduled posts ready to publish`);

    // Mark as posting and queue each
    await db('scheduled_posts')
      .whereIn('id', duePostIds)
      .update({ status: 'posting', updated_at: db.fn.now() });

    for (const postId of duePostIds) {
      await socialQueue.add('publish', { postId }, { priority: 1 });
    }

    return { success: true, queued: duePostIds.length };
  } catch (err) {
    logger.error('Scheduled post check failed', { error: err.message });
    throw err;
  }
});

// ---------- Recurring scheduler ------------------------------------------------

// Check for scheduled posts every minute
socialQueue.add('check-scheduled', {}, {
  repeat: { every: 60 * 1000 },
  jobId: 'scheduled-post-checker',
  removeOnComplete: true,
  removeOnFail: true,
});

// ---------- Event handlers -----------------------------------------------------

socialQueue.on('ready', () => {
  logger.info('Social worker connected and ready');
});

socialQueue.on('error', (err) => {
  logger.error('Social worker queue error', { error: err.message });
});

socialQueue.on('failed', (job, err) => {
  logger.error('Social job failed', {
    jobId: job.id,
    name: job.name,
    data: job.data,
    error: err.message,
    attemptsMade: job.attemptsMade,
  });
});

socialQueue.on('completed', (job, result) => {
  logger.info('Social job completed', {
    jobId: job.id,
    name: job.name,
    result,
  });
});

socialQueue.on('stalled', (jobId) => {
  logger.warn('Social job stalled', { jobId });
});

// ---------- Graceful shutdown --------------------------------------------------

async function gracefulShutdown(signal) {
  logger.info(`Social worker received ${signal}, shutting down...`);
  try {
    await socialQueue.close(5000);
  } catch (err) {
    logger.error('Social worker shutdown error', { error: err.message });
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  logger.info('Social worker starting in standalone mode...');
}

module.exports = socialQueue;
