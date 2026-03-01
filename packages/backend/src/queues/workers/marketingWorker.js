/**
 * Marketing Worker
 *
 * Bull queue processor for marketing asset generation. After an app is deployed,
 * this worker captures screenshots, generates demo videos, and creates marketing
 * copy (landing pages, social posts, ad copy, email templates).
 *
 * Can run as a standalone process:
 *   node packages/backend/src/queues/workers/marketingWorker.js
 */

const marketingQueue = require('../marketingQueue');
const { db } = require('../../config/database');
const logger = require('../../config/logger');
const progressEmitter = require('../progressEmitter');
const screenshotService = require('../../services/screenshotService');
const videoService = require('../../services/videoService');
const llmRouter = require('../../services/llmRouter');
const promptTracker = require('../../services/promptTracker');
const costTracker = require('../../services/costTracker');
const {
  buildLandingPagePrompt,
  buildSocialPostsPrompt,
  buildAdCopyPrompt,
  buildEmailTemplatePrompt,
  buildDemoScriptPrompt,
} = require('../../utils/prompts/marketing');

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

marketingQueue.process(async (job) => {
  const { projectId, deploymentUrl, assetTypes } = job.data;
  const jobId = job.id;

  logger.info('Marketing job started', { jobId, projectId, assetTypes });

  const project = await db('projects').where({ id: projectId }).first();
  if (!project) {
    throw new Error(`Project ${projectId} not found`);
  }

  const url = deploymentUrl || project.deployment_url;
  if (!url) {
    throw new Error('No deployment URL available. Deploy the project first.');
  }

  // Determine which assets to generate
  const types = assetTypes || [
    'screenshot',
    'video_demo',
    'landing_page',
    'social_post',
    'ad_copy',
    'email_template',
  ];

  const totalStages = types.length;
  let completedStages = 0;
  const results = [];

  try {
    for (const assetType of types) {
      const stagePct = Math.round(((completedStages / totalStages) * 80) + 10);
      await emitProgress(projectId, stagePct, 'marketing', `Generating ${assetType.replace(/_/g, ' ')}...`);

      try {
        let result;

        switch (assetType) {
          case 'screenshot':
            result = await generateScreenshots(project, url);
            break;
          case 'video_demo':
            result = await generateVideoDemo(project, url);
            break;
          case 'landing_page':
            result = await generateLandingPage(project);
            break;
          case 'social_post':
            result = await generateSocialPosts(project);
            break;
          case 'ad_copy':
            result = await generateAdCopy(project);
            break;
          case 'email_template':
            result = await generateEmailTemplates(project);
            break;
          default:
            logger.warn('Unknown asset type', { assetType });
            continue;
        }

        if (result) {
          results.push(...(Array.isArray(result) ? result : [result]));
        }
      } catch (err) {
        logger.error('Failed to generate marketing asset', {
          projectId,
          assetType,
          error: err.message,
        });

        // Record the failure but continue with other assets
        await db('marketing_assets').insert({
          project_id: projectId,
          asset_type: assetType,
          status: 'failed',
          metadata: JSON.stringify({ error: err.message }),
        });
      }

      completedStages++;
    }

    await emitProgress(projectId, 100, 'marketing_complete', 'Marketing assets generated!');

    logger.info('Marketing job completed', {
      jobId,
      projectId,
      assetsGenerated: results.length,
    });

    return { success: true, projectId, assets: results.length };
  } catch (error) {
    logger.error('Marketing job failed', {
      jobId,
      projectId,
      error: error.message,
    });

    await emitProgress(projectId, -1, 'error', `Marketing generation failed: ${error.message}`);
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Asset generation functions
// ---------------------------------------------------------------------------

async function generateScreenshots(project, url) {
  const assets = [];

  // Desktop full-page
  try {
    const desktop = await screenshotService.captureFullPage(url);
    const [asset] = await db('marketing_assets')
      .insert({
        project_id: project.id,
        asset_type: 'screenshot',
        file_url: desktop.storageUrl,
        metadata: JSON.stringify({
          type: 'desktop_full',
          width: desktop.width,
          height: desktop.height,
        }),
        status: 'completed',
      })
      .returning('*');

    await costTracker.trackStorageCost(project.id, 500000); // ~500KB estimate
    assets.push(asset);
  } catch (err) {
    logger.warn('Desktop screenshot failed', { error: err.message });
  }

  // Mobile
  try {
    const mobile = await screenshotService.captureMobileView(url);
    const [asset] = await db('marketing_assets')
      .insert({
        project_id: project.id,
        asset_type: 'screenshot',
        file_url: mobile.storageUrl,
        metadata: JSON.stringify({
          type: 'mobile',
          width: mobile.width,
          height: mobile.height,
        }),
        status: 'completed',
      })
      .returning('*');

    await costTracker.trackStorageCost(project.id, 300000); // ~300KB estimate
    assets.push(asset);
  } catch (err) {
    logger.warn('Mobile screenshot failed', { error: err.message });
  }

  return assets;
}

async function generateVideoDemo(project, url) {
  // Generate demo steps
  const steps = await videoService.generateDemoScript(
    project.name,
    project.description,
    project.app_type
  );

  const video = await videoService.generateDemoVideo(url, steps);

  const [asset] = await db('marketing_assets')
    .insert({
      project_id: project.id,
      asset_type: 'video_demo',
      file_url: video.storageUrl,
      metadata: JSON.stringify({
        duration: video.duration,
        width: video.width,
        height: video.height,
      }),
      status: 'completed',
    })
    .returning('*');

  // Estimate video storage cost (~5MB)
  await costTracker.trackStorageCost(project.id, 5 * 1024 * 1024);

  return asset;
}

async function generateLandingPage(project) {
  const prompt = buildLandingPagePrompt(
    project.name,
    project.description || 'An AI-generated application',
    [], // Features extracted from context if available
    []  // Screenshot URLs could be passed here
  );

  const result = await promptTracker.track({
    projectId: project.id,
    userId: project.user_id,
    taskType: 'landing-page',
    prompt: prompt.prompt,
    systemMessage: prompt.systemMessage,
    callFn: () => llmRouter.route('landing-page', {
      systemMessage: prompt.systemMessage,
      prompt: prompt.prompt,
      maxTokens: 8000,
    }),
  });

  const [asset] = await db('marketing_assets')
    .insert({
      project_id: project.id,
      asset_type: 'landing_page',
      content: result.content,
      status: 'completed',
      generation_cost: result.cost?.totalCost || 0,
      prompt_log_id: result.promptLogId || null,
    })
    .returning('*');

  return asset;
}

async function generateSocialPosts(project) {
  const platforms = ['twitter', 'linkedin', 'instagram', 'facebook'];
  const assets = [];

  for (const platform of platforms) {
    try {
      const prompt = buildSocialPostsPrompt(
        project.name,
        project.description || 'An innovative application',
        platform
      );

      const result = await promptTracker.track({
        projectId: project.id,
        userId: project.user_id,
        taskType: 'social-copy',
        prompt: prompt.prompt,
        systemMessage: prompt.systemMessage,
        callFn: () => llmRouter.route('social-copy', {
          systemMessage: prompt.systemMessage,
          prompt: prompt.prompt,
          responseFormat: 'json',
          maxTokens: 2000,
        }),
      });

      const [asset] = await db('marketing_assets')
        .insert({
          project_id: project.id,
          asset_type: 'social_post',
          content: result.content,
          metadata: JSON.stringify({ platform }),
          status: 'completed',
          generation_cost: result.cost?.totalCost || 0,
          prompt_log_id: result.promptLogId || null,
        })
        .returning('*');

      assets.push(asset);
    } catch (err) {
      logger.warn(`Social post generation failed for ${platform}`, {
        error: err.message,
      });
    }
  }

  return assets;
}

async function generateAdCopy(project) {
  const platforms = ['google', 'facebook', 'linkedin'];
  const assets = [];

  for (const platform of platforms) {
    try {
      const prompt = buildAdCopyPrompt(
        project.name,
        project.description || 'A powerful application',
        platform
      );

      const result = await promptTracker.track({
        projectId: project.id,
        userId: project.user_id,
        taskType: 'ad-copy',
        prompt: prompt.prompt,
        systemMessage: prompt.systemMessage,
        callFn: () => llmRouter.route('ad-copy', {
          systemMessage: prompt.systemMessage,
          prompt: prompt.prompt,
          responseFormat: 'json',
          maxTokens: 2000,
        }),
      });

      const [asset] = await db('marketing_assets')
        .insert({
          project_id: project.id,
          asset_type: 'ad_copy',
          content: result.content,
          metadata: JSON.stringify({ platform }),
          status: 'completed',
          generation_cost: result.cost?.totalCost || 0,
          prompt_log_id: result.promptLogId || null,
        })
        .returning('*');

      assets.push(asset);
    } catch (err) {
      logger.warn(`Ad copy generation failed for ${platform}`, {
        error: err.message,
      });
    }
  }

  return assets;
}

async function generateEmailTemplates(project) {
  const emailTypes = ['launch', 'feature', 'onboarding'];
  const assets = [];

  for (const emailType of emailTypes) {
    try {
      const prompt = buildEmailTemplatePrompt(
        project.name,
        project.description || 'An innovative application',
        emailType
      );

      const result = await promptTracker.track({
        projectId: project.id,
        userId: project.user_id,
        taskType: 'email-template',
        prompt: prompt.prompt,
        systemMessage: prompt.systemMessage,
        callFn: () => llmRouter.route('email-template', {
          systemMessage: prompt.systemMessage,
          prompt: prompt.prompt,
          responseFormat: 'json',
          maxTokens: 4000,
        }),
      });

      const [asset] = await db('marketing_assets')
        .insert({
          project_id: project.id,
          asset_type: 'email_template',
          content: result.content,
          metadata: JSON.stringify({ email_type: emailType }),
          status: 'completed',
          generation_cost: result.cost?.totalCost || 0,
          prompt_log_id: result.promptLogId || null,
        })
        .returning('*');

      assets.push(asset);
    } catch (err) {
      logger.warn(`Email template generation failed for ${emailType}`, {
        error: err.message,
      });
    }
  }

  return assets;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function emitProgress(projectId, progress, stage, message) {
  await progressEmitter.emit(projectId, { progress, stage, message });
}

// ---------------------------------------------------------------------------
// Queue events
// ---------------------------------------------------------------------------

marketingQueue.on('ready', () => {
  logger.info('Marketing worker connected and ready');
});

marketingQueue.on('error', (err) => {
  logger.error('Marketing worker queue error', { error: err.message });
});

marketingQueue.on('stalled', (job) => {
  logger.warn('Marketing job stalled', { jobId: job.id });
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

async function gracefulShutdown(signal) {
  logger.info(`Marketing worker received ${signal}, shutting down...`);
  try {
    await marketingQueue.close(5000);
    await screenshotService.close();
    await videoService.close();
    logger.info('Marketing worker shut down cleanly');
  } catch (err) {
    logger.error('Error during marketing worker shutdown', { error: err.message });
  }
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

if (require.main === module) {
  logger.info('Marketing worker starting in standalone mode...');
}

module.exports = marketingQueue;
