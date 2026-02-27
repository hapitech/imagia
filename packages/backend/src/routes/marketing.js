const express = require('express');
const Joi = require('joi');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const { validate } = require('../middleware/requestValidator');
const marketingQueue = require('../queues/marketingQueue');

const router = express.Router();
router.use(requireUser);

const generateSchema = Joi.object({
  project_id: Joi.string().uuid().required(),
  asset_types: Joi.array()
    .items(
      Joi.string().valid(
        'screenshot',
        'video_demo',
        'landing_page',
        'social_post',
        'ad_copy',
        'email_template'
      )
    )
    .optional(),
});

// Helper: verify ownership
async function verifyOwnership(projectId, userId) {
  return db('projects').where({ id: projectId, user_id: userId }).first();
}

// POST /generate - Queue marketing asset generation
router.post('/generate', validate(generateSchema), async (req, res, next) => {
  try {
    const { project_id, asset_types } = req.body;

    const project = await verifyOwnership(project_id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!project.deployment_url) {
      return res.status(400).json({
        error: 'Project must be deployed before generating marketing assets',
      });
    }

    const job = await marketingQueue.add({
      projectId: project_id,
      deploymentUrl: project.deployment_url,
      assetTypes: asset_types || null,
    });

    res.status(202).json({
      message: 'Marketing generation queued',
      job_id: job.id,
      project_id,
    });
  } catch (err) {
    next(err);
  }
});

// GET /assets/:projectId - List marketing assets for a project
router.get('/assets/:projectId', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { type, status } = req.query;

    let query = db('marketing_assets')
      .where({ project_id: req.params.projectId })
      .orderBy('created_at', 'desc');

    if (type) query = query.where({ asset_type: type });
    if (status) query = query.where({ status });

    const assets = await query;

    // Group assets by type for easier frontend consumption
    const grouped = {};
    for (const asset of assets) {
      if (!grouped[asset.asset_type]) {
        grouped[asset.asset_type] = [];
      }
      // Parse metadata if it's a JSON string
      if (typeof asset.metadata === 'string') {
        try { asset.metadata = JSON.parse(asset.metadata); } catch { /* noop */ }
      }
      grouped[asset.asset_type].push(asset);
    }

    res.json({
      assets,
      grouped,
      total: assets.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /assets/:projectId/:assetId - Get a single marketing asset
router.get('/assets/:projectId/:assetId', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const asset = await db('marketing_assets')
      .where({ id: req.params.assetId, project_id: req.params.projectId })
      .first();

    if (!asset) return res.status(404).json({ error: 'Asset not found' });

    if (typeof asset.metadata === 'string') {
      try { asset.metadata = JSON.parse(asset.metadata); } catch { /* noop */ }
    }

    res.json({ asset });
  } catch (err) {
    next(err);
  }
});

// DELETE /assets/:projectId/:assetId - Delete a marketing asset
router.delete('/assets/:projectId/:assetId', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const deleted = await db('marketing_assets')
      .where({ id: req.params.assetId, project_id: req.params.projectId })
      .del();

    if (!deleted) return res.status(404).json({ error: 'Asset not found' });

    res.json({ message: 'Asset deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /assets/:projectId/regenerate/:assetType - Regenerate a specific asset type
router.post('/assets/:projectId/regenerate/:assetType', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const validTypes = ['screenshot', 'video_demo', 'landing_page', 'social_post', 'ad_copy', 'email_template'];
    if (!validTypes.includes(req.params.assetType)) {
      return res.status(400).json({ error: 'Invalid asset type' });
    }

    const job = await marketingQueue.add({
      projectId: req.params.projectId,
      deploymentUrl: project.deployment_url,
      assetTypes: [req.params.assetType],
    });

    res.status(202).json({
      message: `Regenerating ${req.params.assetType}`,
      job_id: job.id,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
