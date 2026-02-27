/**
 * Deploy Worker
 *
 * Bull queue processor for deployment jobs. Creates a Railway project/service,
 * connects it to a GitHub repo (if available) or triggers a source deploy,
 * polls for completion, and updates the project + deployments table.
 *
 * Can run as a standalone process:
 *   node packages/backend/src/queues/workers/deployWorker.js
 */

const deployQueue = require('../deployQueue');
const { db } = require('../../config/database');
const logger = require('../../config/logger');
const railwayService = require('../../services/railwayService');
const progressEmitter = require('../progressEmitter');
const { decrypt } = require('../../utils/encryption');
const costTracker = require('../../services/costTracker');
const marketingQueue = require('../marketingQueue');

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

deployQueue.process(async (job) => {
  const { projectId, userId } = job.data;
  const jobId = job.id;

  logger.info('Deploy job started', { jobId, projectId });

  const project = await db('projects').where({ id: projectId }).first();
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  // Create a deployment record
  const [deployment] = await db('deployments')
    .insert({
      project_id: projectId,
      status: 'pending',
    })
    .returning('*');

  const deploymentId = deployment.id;

  try {
    // ---- Stage 1: Initialize (0-10%) ----
    await emitProgress(projectId, 5, 'deploying', 'Preparing deployment...');
    await db('projects').where({ id: projectId }).update({
      status: 'deploying',
      build_progress: 5,
      current_build_stage: 'deploying',
      updated_at: db.fn.now(),
    });

    await db('deployments').where({ id: deploymentId }).update({
      status: 'building',
      deployment_started_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    // ---- Stage 2: Create Railway project (10-25%) ----
    await emitProgress(projectId, 15, 'deploying', 'Creating Railway project...');

    let railwayProjectId = project.railway_project_id;
    let railwayServiceId = project.railway_service_id;
    let environmentId;

    if (!railwayProjectId) {
      const railwayProject = await railwayService.createProject(project.name);
      railwayProjectId = railwayProject.id;

      await db('projects').where({ id: projectId }).update({
        railway_project_id: railwayProjectId,
        updated_at: db.fn.now(),
      });
    }

    // ---- Stage 3: Create service + set env vars (25-40%) ----
    await emitProgress(projectId, 30, 'deploying', 'Configuring service...');

    if (!railwayServiceId) {
      const service = await railwayService.createService(railwayProjectId, project.name);
      railwayServiceId = service.id;
      environmentId = service.environmentId;

      await db('projects').where({ id: projectId }).update({
        railway_service_id: railwayServiceId,
        updated_at: db.fn.now(),
      });
    } else {
      // Fetch environmentId from existing project
      const status = await railwayService.getServiceStatus(railwayProjectId, railwayServiceId);
      environmentId = status.environmentId;
    }

    await db('deployments').where({ id: deploymentId }).update({
      railway_project_id: railwayProjectId,
      railway_service_id: railwayServiceId,
      railway_environment_id: environmentId,
      updated_at: db.fn.now(),
    });

    // Set environment variables from project secrets
    await emitProgress(projectId, 35, 'deploying', 'Setting environment variables...');
    const secrets = await db('project_secrets').where({ project_id: projectId });
    if (secrets.length > 0 && environmentId) {
      const envVars = {};
      for (const secret of secrets) {
        try {
          envVars[secret.key] = decrypt(secret.encrypted_value);
        } catch (e) {
          logger.warn('Failed to decrypt secret for deployment', { key: secret.key });
        }
      }
      if (Object.keys(envVars).length > 0) {
        await railwayService.setEnvironmentVariables(
          railwayProjectId,
          environmentId,
          railwayServiceId,
          envVars
        );
      }
    }

    // ---- Stage 4: Deploy (40-60%) ----
    await emitProgress(projectId, 45, 'deploying', 'Deploying application...');

    // Check if project has a connected GitHub repo
    const githubConnection = await db('github_connections')
      .where({ project_id: projectId })
      .first();

    if (githubConnection) {
      // Deploy via GitHub connection
      await railwayService.connectGitHubRepo(
        railwayProjectId,
        railwayServiceId,
        githubConnection.repo_full_name,
        githubConnection.default_branch
      );
    } else {
      // Trigger deploy from source
      await railwayService.deployFromSource(
        railwayProjectId,
        railwayServiceId,
        environmentId
      );
    }

    await db('deployments').where({ id: deploymentId }).update({
      status: 'deploying',
      updated_at: db.fn.now(),
    });

    // ---- Stage 5: Generate domain (60-65%) ----
    await emitProgress(projectId, 60, 'deploying', 'Setting up domain...');

    let deploymentUrl = project.deployment_url;
    if (!deploymentUrl && environmentId) {
      deploymentUrl = await railwayService.generateDomain(railwayServiceId, environmentId);
    }

    // ---- Stage 6: Wait for deployment (65-90%) ----
    await emitProgress(projectId, 70, 'deploying', 'Waiting for deployment to complete...');

    const finalStatus = await railwayService.waitForDeployment(
      railwayProjectId,
      railwayServiceId,
      600000, // 10 min timeout
      10000,  // check every 10s
      (status) => {
        // Progressive updates
        const currentPct = Math.min(90, 70 + Math.floor(Math.random() * 10));
        emitProgress(projectId, currentPct, 'deploying', `Deployment status: ${status.status}`);
        if (status.url) deploymentUrl = status.url;
      }
    );

    if (finalStatus.status === 'FAILED' || finalStatus.status === 'CRASHED') {
      throw new Error(`Deployment failed with status: ${finalStatus.status}`);
    }

    if (finalStatus.status === 'TIMEOUT') {
      throw new Error('Deployment timed out after 10 minutes');
    }

    if (finalStatus.url) {
      deploymentUrl = finalStatus.url;
    }

    // ---- Stage 7: Finalize (90-100%) ----
    await emitProgress(projectId, 95, 'deploying', 'Finalizing deployment...');

    await db('deployments').where({ id: deploymentId }).update({
      status: 'success',
      url: deploymentUrl,
      railway_deployment_id: finalStatus.deploymentId,
      deployment_completed_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('projects').where({ id: projectId }).update({
      status: 'deployed',
      deployment_url: deploymentUrl,
      deployed_at: db.fn.now(),
      build_progress: 100,
      current_build_stage: 'deployed',
      error_message: null,
      updated_at: db.fn.now(),
    });

    // Track deployment cost
    await costTracker.trackDeploymentCost(projectId, deploymentId, {
      buildMinutes: Math.round((Date.now() - deployment.created_at) / 60000) || 2,
      type: 'deploy',
    });

    await emitProgress(projectId, 100, 'deployed', 'Deployment successful!');

    // Queue marketing asset generation
    if (deploymentUrl) {
      await marketingQueue.add({
        projectId,
        deploymentUrl,
      });
      logger.info('Marketing generation queued after deployment', { projectId });
    }

    logger.info('Deploy job completed', {
      jobId,
      projectId,
      deploymentId,
      url: deploymentUrl,
    });

    return { success: true, projectId, deploymentId, url: deploymentUrl };
  } catch (error) {
    logger.error('Deploy job failed', {
      jobId,
      projectId,
      error: error.message,
      stack: error.stack,
    });

    await db('deployments').where({ id: deploymentId }).update({
      status: 'failed',
      error_message: error.message,
      deployment_completed_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('projects').where({ id: projectId }).update({
      status: 'failed',
      error_message: `Deployment failed: ${error.message}`,
      updated_at: db.fn.now(),
    });

    await emitProgress(projectId, -1, 'error', error.message || 'Deployment failed');

    throw error;
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function emitProgress(projectId, progress, stage, message) {
  await progressEmitter.emit(projectId, { progress, stage, message });
}

// ---------------------------------------------------------------------------
// Queue event logging
// ---------------------------------------------------------------------------

deployQueue.on('ready', () => {
  logger.info('Deploy worker connected and ready to process jobs');
});

deployQueue.on('error', (err) => {
  logger.error('Deploy worker queue error', { error: err.message });
});

deployQueue.on('stalled', (job) => {
  logger.warn('Deploy job stalled', { jobId: job.id, data: job.data });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function gracefulShutdown(signal) {
  logger.info(`Deploy worker received ${signal}, shutting down gracefully...`);
  try {
    await deployQueue.close(5000);
    logger.info('Deploy worker shut down cleanly');
  } catch (err) {
    logger.error('Error during deploy worker shutdown', { error: err.message });
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// ---------------------------------------------------------------------------
// Standalone execution
// ---------------------------------------------------------------------------

if (require.main === module) {
  logger.info('Deploy worker starting in standalone mode...');
}

module.exports = deployQueue;
