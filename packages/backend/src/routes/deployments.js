const express = require('express');
const Joi = require('joi');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const { validate } = require('../middleware/requestValidator');
const deployQueue = require('../queues/deployQueue');
const railwayService = require('../services/railwayService');

const router = express.Router();
router.use(requireUser);

const deploySchema = Joi.object({
  project_id: Joi.string().uuid().required(),
});

const customDomainSchema = Joi.object({
  domain: Joi.string().hostname().required(),
});

// Helper: verify ownership
async function verifyOwnership(projectId, userId) {
  return db('projects').where({ id: projectId, user_id: userId }).first();
}

// POST / - Queue a deployment job
router.post('/', validate(deploySchema), async (req, res, next) => {
  try {
    const { project_id } = req.body;
    const project = await verifyOwnership(project_id, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Don't allow deploying if already deploying
    if (project.status === 'deploying') {
      return res.status(409).json({ error: 'Deployment already in progress' });
    }

    // Ensure project has files
    const fileCount = await db('project_files')
      .where({ project_id })
      .count('* as count')
      .first();

    if (parseInt(fileCount.count, 10) === 0) {
      return res.status(400).json({ error: 'No files to deploy. Build the project first.' });
    }

    const job = await deployQueue.add({
      projectId: project_id,
      userId: req.user.id,
    });

    res.status(202).json({
      message: 'Deployment queued',
      job_id: job.id,
      project_id,
    });
  } catch (err) {
    next(err);
  }
});

// GET /:projectId/status - Get deployment status
router.get('/:projectId/status', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const latestDeployment = await db('deployments')
      .where({ project_id: req.params.projectId })
      .orderBy('created_at', 'desc')
      .first();

    res.json({
      project_status: project.status,
      deployment_url: project.deployment_url,
      latest_deployment: latestDeployment || null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /:projectId/history - Get deployment history
router.get('/:projectId/history', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const deployments = await db('deployments')
      .where({ project_id: req.params.projectId })
      .orderBy('created_at', 'desc')
      .limit(20);

    res.json({ deployments });
  } catch (err) {
    next(err);
  }
});

// GET /:projectId/logs - Get deployment logs
router.get('/:projectId/logs', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const latestDeployment = await db('deployments')
      .where({ project_id: req.params.projectId })
      .orderBy('created_at', 'desc')
      .first();

    if (!latestDeployment || !latestDeployment.railway_deployment_id) {
      return res.json({ logs: [] });
    }

    const logs = await railwayService.getDeploymentLogs(latestDeployment.railway_deployment_id);
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

// PATCH /:projectId/domain - Configure custom domain
router.patch('/:projectId/domain', validate(customDomainSchema), async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    if (!project.railway_service_id) {
      return res.status(400).json({ error: 'Project has not been deployed yet' });
    }

    // Get the environment ID from the latest deployment
    const deployment = await db('deployments')
      .where({ project_id: req.params.projectId, status: 'success' })
      .orderBy('created_at', 'desc')
      .first();

    if (!deployment || !deployment.railway_environment_id) {
      return res.status(400).json({ error: 'No successful deployment found' });
    }

    const result = await railwayService.addCustomDomain(
      project.railway_service_id,
      deployment.railway_environment_id,
      req.body.domain
    );

    // Update the deployment record
    await db('deployments')
      .where({ id: deployment.id })
      .update({ custom_domain: req.body.domain, updated_at: db.fn.now() });

    res.json({
      message: 'Custom domain configured',
      domain: req.body.domain,
      dns_records: result.status?.dnsRecords || [],
    });
  } catch (err) {
    next(err);
  }
});

// GET /:projectId/costs - Deployment cost breakdown
router.get('/:projectId/costs', async (req, res, next) => {
  try {
    const project = await verifyOwnership(req.params.projectId, req.user.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const deployments = await db('deployments')
      .where({ project_id: req.params.projectId })
      .select('id', 'status', 'cost', 'created_at');

    const totalDeploymentCost = deployments.reduce((sum, d) => sum + parseFloat(d.cost || 0), 0);

    // Get project cost breakdown
    const costBreakdown = typeof project.cost_breakdown === 'string'
      ? JSON.parse(project.cost_breakdown)
      : project.cost_breakdown || {};

    res.json({
      cost_breakdown: costBreakdown,
      deployment_cost: parseFloat(totalDeploymentCost.toFixed(6)),
      deployments: deployments.map((d) => ({
        id: d.id,
        status: d.status,
        cost: parseFloat(d.cost || 0),
        created_at: d.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
