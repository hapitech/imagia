const express = require('express');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const costTracker = require('../services/costTracker');

const router = express.Router();

// All routes require authentication
router.use(requireUser);

// GET /llm-costs - LLM cost dashboard
router.get('/llm-costs', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    // Summary
    const [summary] = await db('prompt_logs')
      .where({ user_id: userId })
      .where('created_at', '>=', sinceDate.toISOString())
      .select(
        db.raw('COALESCE(SUM(total_cost), 0) as total_cost'),
        db.raw('COUNT(*) as total_requests'),
        db.raw('COALESCE(SUM(total_tokens), 0) as total_tokens'),
        db.raw('COALESCE(AVG(latency_ms), 0) as avg_latency_ms')
      );

    // By provider
    const byProvider = await db('prompt_logs')
      .where({ user_id: userId })
      .where('created_at', '>=', sinceDate.toISOString())
      .groupBy('provider')
      .select(
        'provider',
        db.raw('COUNT(*) as requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as cost'),
        db.raw('COALESCE(SUM(total_tokens), 0) as tokens'),
        db.raw('COALESCE(AVG(latency_ms), 0) as avg_latency_ms')
      )
      .orderBy('cost', 'desc');

    // By task type
    const byTask = await db('prompt_logs')
      .where({ user_id: userId })
      .where('created_at', '>=', sinceDate.toISOString())
      .groupBy('task_type')
      .select(
        'task_type',
        db.raw('COUNT(*) as requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as cost'),
        db.raw('COALESCE(SUM(total_tokens), 0) as tokens')
      )
      .orderBy('cost', 'desc');

    // Daily trend
    const dailyTrend = await db('prompt_logs')
      .where({ user_id: userId })
      .where('created_at', '>=', sinceDate.toISOString())
      .groupByRaw('DATE(created_at)')
      .select(
        db.raw('DATE(created_at) as date'),
        db.raw('COUNT(*) as requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as cost'),
        db.raw('COALESCE(SUM(total_tokens), 0) as tokens')
      )
      .orderBy('date', 'asc');

    res.json({
      summary: {
        total_cost: parseFloat(summary.total_cost),
        total_requests: parseInt(summary.total_requests, 10),
        total_tokens: parseInt(summary.total_tokens, 10),
        avg_latency_ms: parseFloat(summary.avg_latency_ms),
      },
      by_provider: byProvider,
      by_task: byTask,
      daily_trend: dailyTrend,
    });
  } catch (err) {
    next(err);
  }
});

// GET /llm-costs/:projectId - Per-project cost breakdown
router.get('/llm-costs/:projectId', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.projectId, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Detailed breakdown from prompt_logs
    const [totals] = await db('prompt_logs')
      .where({ project_id: project.id, user_id: req.user.id })
      .select(
        db.raw('COUNT(*) as total_requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as total_cost'),
        db.raw('COALESCE(SUM(total_tokens), 0) as total_tokens'),
        db.raw('COALESCE(AVG(latency_ms), 0) as avg_latency_ms')
      );

    const byProvider = await db('prompt_logs')
      .where({ project_id: project.id, user_id: req.user.id })
      .groupBy('provider')
      .select(
        'provider',
        db.raw('COUNT(*) as requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as cost'),
        db.raw('COALESCE(SUM(total_tokens), 0) as tokens')
      )
      .orderBy('cost', 'desc');

    const byTask = await db('prompt_logs')
      .where({ project_id: project.id, user_id: req.user.id })
      .groupBy('task_type')
      .select(
        'task_type',
        db.raw('COUNT(*) as requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as cost'),
        db.raw('COALESCE(SUM(total_tokens), 0) as tokens')
      )
      .orderBy('cost', 'desc');

    res.json({
      cost_breakdown: project.cost_breakdown,
      details: {
        total_requests: parseInt(totals.total_requests, 10),
        total_cost: parseFloat(totals.total_cost),
        total_tokens: parseInt(totals.total_tokens, 10),
        avg_latency_ms: parseFloat(totals.avg_latency_ms),
        by_provider: byProvider,
        by_task: byTask,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /llm-costs/by-model - Breakdown by model
router.get('/llm-costs/by-model', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const byModel = await db('prompt_logs')
      .where({ user_id: userId })
      .where('created_at', '>=', sinceDate.toISOString())
      .groupBy('provider', 'model')
      .select(
        'provider',
        'model',
        db.raw('COUNT(*) as requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as cost'),
        db.raw('COALESCE(SUM(input_tokens), 0) as input_tokens'),
        db.raw('COALESCE(SUM(output_tokens), 0) as output_tokens'),
        db.raw('COALESCE(SUM(total_tokens), 0) as tokens'),
        db.raw('COALESCE(AVG(latency_ms), 0) as avg_latency_ms'),
        db.raw("COUNT(*) FILTER (WHERE status != 'success') as error_count"),
        db.raw('COUNT(*) FILTER (WHERE cache_hit = true) as cache_hit_count')
      )
      .orderBy('cost', 'desc');

    res.json({ by_model: byModel });
  } catch (err) {
    next(err);
  }
});

// GET /usage-daily - Aggregated daily usage from llm_usage_daily table
router.get('/usage-daily', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const daily = await db('llm_usage_daily')
      .where({ user_id: userId })
      .where('date', '>=', sinceDate.toISOString().split('T')[0])
      .select(
        'date',
        db.raw('SUM(request_count) as requests'),
        db.raw('SUM(total_cost) as cost'),
        db.raw('SUM(total_input_tokens) as input_tokens'),
        db.raw('SUM(total_output_tokens) as output_tokens'),
        db.raw('SUM(error_count) as errors'),
        db.raw('SUM(cache_hit_count) as cache_hits')
      )
      .groupBy('date')
      .orderBy('date', 'asc');

    res.json({ daily });
  } catch (err) {
    next(err);
  }
});

// GET /costs - Full cost summary (LLM + deployment + storage + marketing)
router.get('/costs', async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const summary = await costTracker.getUserCostSummary(req.user.id, days);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// GET /costs/:projectId - Full project cost breakdown
router.get('/costs/:projectId', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.projectId, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const costs = await costTracker.getProjectCosts(req.params.projectId);
    res.json(costs);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
