const express = require('express');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const buildQueue = require('../queues/buildQueue');
const progressEmitter = require('../queues/progressEmitter');

const router = express.Router();

// All routes require authentication
router.use(requireUser);

// GET /status/:projectId - Get build status
router.get('/status/:projectId', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.projectId, user_id: req.user.id })
      .select('id', 'build_progress', 'current_build_stage', 'status', 'error_message')
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (err) {
    next(err);
  }
});

// GET /progress/:projectId - SSE progress stream
router.get('/progress/:projectId', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.projectId, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'connected', projectId: req.params.projectId })}\n\n`);

    // Subscribe to progress events
    const unsubscribe = progressEmitter.subscribe(req.params.projectId, (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    });

    // Clean up on client disconnect
    req.on('close', () => {
      unsubscribe();
    });
  } catch (err) {
    next(err);
  }
});

// POST /cancel/:projectId - Cancel build
router.post('/cancel/:projectId', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.projectId, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await db('projects')
      .where({ id: req.params.projectId })
      .update({
        status: 'failed',
        error_message: 'Cancelled by user',
        updated_at: db.fn.now(),
      });

    res.json({ message: 'Build cancelled' });
  } catch (err) {
    next(err);
  }
});

// GET /queue/stats - Queue statistics
router.get('/queue/stats', async (req, res, next) => {
  try {
    const jobCounts = await buildQueue.getJobCounts();
    res.json(jobCounts);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
