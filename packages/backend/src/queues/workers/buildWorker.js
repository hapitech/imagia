/**
 * Build Worker
 *
 * Bull queue processor for build jobs. Determines whether a project needs a
 * first-time scaffold or an iterative update, delegates to appBuilderService,
 * and keeps the project row + SSE progress stream in sync throughout.
 *
 * Can run as a standalone process:
 *   node packages/backend/src/queues/workers/buildWorker.js
 */

const buildQueue = require('../buildQueue');
const { db } = require('../../config/database');
const logger = require('../../config/logger');
const appBuilderService = require('../../services/appBuilderService');
const progressEmitter = require('../progressEmitter');

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

buildQueue.process(async (job) => {
  const { projectId, conversationId, messageId } = job.data;
  const jobId = job.id;

  logger.info('Build job started', { jobId, projectId, conversationId, messageId });

  // 1. Fetch the project to get user_id and validate it exists
  const project = await db('projects').where({ id: projectId }).first();

  if (!project) {
    logger.error('Build job failed: project not found', { jobId, projectId });
    throw new Error(`Project ${projectId} not found`);
  }

  const userId = project.user_id;
  const correlationId = `build-${jobId}`;

  try {
    // 2. Mark project as building
    await db('projects').where({ id: projectId }).update({
      status: 'building',
      build_progress: 0,
      current_build_stage: 'initializing',
      error_message: null,
      queued_at: project.queued_at || db.fn.now(),
      build_started_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await progressEmitter.emit(projectId, {
      progress: 0,
      stage: 'initializing',
      message: 'Build started...',
    });

    // 3. Determine first build vs iteration by checking existing file count
    const result = await db('project_files')
      .where('project_id', projectId)
      .count('* as count')
      .first();

    const existingFileCount = parseInt(result.count, 10) || 0;
    const isFirstBuild = existingFileCount === 0;

    logger.info('Build type determined', {
      jobId,
      projectId,
      isFirstBuild,
      existingFileCount,
    });

    await progressEmitter.emit(projectId, {
      progress: 5,
      stage: isFirstBuild ? 'scaffolding' : 'analyzing',
      message: isFirstBuild
        ? 'Creating your application...'
        : 'Analyzing changes...',
    });

    await db('projects').where({ id: projectId }).update({
      build_progress: 5,
      current_build_stage: isFirstBuild ? 'scaffolding' : 'analyzing',
      updated_at: db.fn.now(),
    });

    // 4. Delegate to appBuilderService
    const builderArgs = {
      projectId,
      conversationId,
      messageId,
      userId,
      correlationId,
    };

    let buildResult;
    if (isFirstBuild) {
      buildResult = await appBuilderService.buildFromMessage(builderArgs);
    } else {
      buildResult = await appBuilderService.iterateFromMessage(builderArgs);
    }

    // 5. Build succeeded -- update project
    await db('projects').where({ id: projectId }).update({
      status: 'ready',
      build_progress: 100,
      current_build_stage: 'complete',
      error_message: null,
      updated_at: db.fn.now(),
    });

    await progressEmitter.emit(projectId, {
      progress: 100,
      stage: 'complete',
      message: isFirstBuild
        ? 'Application built successfully!'
        : 'Changes applied successfully!',
    });

    logger.info('Build job completed', {
      jobId,
      projectId,
      isFirstBuild,
      filesGenerated: buildResult?.filesWritten ?? null,
    });

    return { success: true, projectId, isFirstBuild };
  } catch (error) {
    // 6. Build failed
    logger.error('Build job failed', {
      jobId,
      projectId,
      error: error.message,
      stack: error.stack,
    });

    // Emit error progress so the frontend shows the failure
    await progressEmitter.emit(projectId, {
      progress: -1,
      stage: 'error',
      message: error.message || 'Build failed unexpectedly',
    });

    // Mark project as failed
    await db('projects').where({ id: projectId }).update({
      status: 'failed',
      build_progress: -1,
      current_build_stage: 'error',
      error_message: error.message || 'Build failed unexpectedly',
      updated_at: db.fn.now(),
    });

    // Store an assistant error message in the conversation so the user sees it
    try {
      await db('messages').insert({
        conversation_id: conversationId,
        role: 'assistant',
        content: `Sorry, the build failed: ${error.message || 'An unexpected error occurred.'}. Please try again or adjust your request.`,
        metadata: JSON.stringify({
          error: true,
          jobId,
          attemptsMade: job.attemptsMade + 1,
        }),
      });

      await db('conversations')
        .where({ id: conversationId })
        .increment('message_count', 1);
    } catch (msgError) {
      logger.error('Failed to store error message in conversation', {
        jobId,
        projectId,
        error: msgError.message,
      });
    }

    // Re-throw so Bull can handle retries according to the queue config
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Queue event logging
// ---------------------------------------------------------------------------

buildQueue.on('ready', () => {
  logger.info('Build worker connected and ready to process jobs');
});

buildQueue.on('error', (err) => {
  logger.error('Build worker queue error', { error: err.message });
});

buildQueue.on('stalled', (job) => {
  logger.warn('Build job stalled', { jobId: job.id, data: job.data });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function gracefulShutdown(signal) {
  logger.info(`Build worker received ${signal}, shutting down gracefully...`);
  try {
    await buildQueue.close(5000); // Wait up to 5s for running jobs
    logger.info('Build worker shut down cleanly');
  } catch (err) {
    logger.error('Error during build worker shutdown', { error: err.message });
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

if (require.main === module) {
  logger.info('Build worker starting in standalone mode...');
}

module.exports = buildQueue;
