const express = require('express');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

// All routes require authentication
router.use(requireUser);

// GET /stats - Aggregate prompt statistics (must be before /:id)
router.get('/stats', async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Overall totals
    const [totals] = await db('prompt_logs')
      .where({ user_id: userId })
      .select(
        db.raw('COUNT(*) as total_requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as total_cost'),
        db.raw('COALESCE(SUM(total_tokens), 0) as total_tokens')
      );

    // By provider
    const byProvider = await db('prompt_logs')
      .where({ user_id: userId })
      .groupBy('provider')
      .select(
        'provider',
        db.raw('COUNT(*) as requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as cost'),
        db.raw('COALESCE(SUM(total_tokens), 0) as tokens')
      )
      .orderBy('cost', 'desc');

    // By task type
    const byTask = await db('prompt_logs')
      .where({ user_id: userId })
      .groupBy('task_type')
      .select(
        'task_type',
        db.raw('COUNT(*) as requests'),
        db.raw('COALESCE(SUM(total_cost), 0) as cost'),
        db.raw('COALESCE(SUM(total_tokens), 0) as tokens')
      )
      .orderBy('cost', 'desc');

    res.json({
      total_requests: parseInt(totals.total_requests, 10),
      total_cost: parseFloat(totals.total_cost),
      total_tokens: parseInt(totals.total_tokens, 10),
      by_provider: byProvider,
      by_task: byTask,
    });
  } catch (err) {
    next(err);
  }
});

// GET / - List prompt logs (with search, model filter, date range, status filter)
router.get('/', async (req, res, next) => {
  try {
    const {
      project_id, task_type, provider, model, status,
      search, date_from, date_to,
      sort_by = 'created_at', sort_order = 'desc',
      page = 1, limit = 20,
    } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const query = db('prompt_logs').where({ user_id: req.user.id });

    if (project_id) {
      query.andWhere({ project_id });
    }
    if (task_type) {
      query.andWhere({ task_type });
    }
    if (provider) {
      query.andWhere({ provider });
    }
    if (model) {
      query.andWhere({ model });
    }
    if (status) {
      query.andWhere({ status });
    }
    if (search) {
      query.andWhere(function () {
        this.where('prompt', 'ilike', `%${search}%`)
          .orWhere('response', 'ilike', `%${search}%`);
      });
    }
    if (date_from) {
      query.andWhere('created_at', '>=', date_from);
    }
    if (date_to) {
      query.andWhere('created_at', '<=', date_to);
    }

    const [{ count }] = await query.clone().count('* as count');
    const total = parseInt(count, 10);

    // Validate sort column to prevent SQL injection
    const allowedSorts = ['created_at', 'total_cost', 'total_tokens', 'latency_ms'];
    const sortCol = allowedSorts.includes(sort_by) ? sort_by : 'created_at';
    const sortDir = sort_order === 'asc' ? 'asc' : 'desc';

    const prompts = await query
      .select(
        'id', 'project_id', 'provider', 'model', 'task_type',
        'input_tokens', 'output_tokens', 'total_tokens',
        'total_cost', 'latency_ms', 'status', 'cache_hit',
        'retry_count', 'correlation_id', 'created_at',
        db.raw('LEFT(prompt, 200) as prompt_preview'),
        db.raw('LEFT(response, 200) as response_preview')
      )
      .orderBy(sortCol, sortDir)
      .limit(limitNum)
      .offset(offset);

    res.json({
      prompts,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /filters - Available filter options (distinct providers, models, task_types, statuses)
router.get('/filters', async (req, res, next) => {
  try {
    const userId = req.user.id;

    const [providers, models, taskTypes, statuses] = await Promise.all([
      db('prompt_logs').where({ user_id: userId }).distinct('provider').pluck('provider'),
      db('prompt_logs').where({ user_id: userId }).distinct('model').pluck('model'),
      db('prompt_logs').where({ user_id: userId }).distinct('task_type').pluck('task_type'),
      db('prompt_logs').where({ user_id: userId }).distinct('status').pluck('status'),
    ]);

    res.json({ providers, models, task_types: taskTypes, statuses });
  } catch (err) {
    next(err);
  }
});

// GET /:id - Get single prompt log detail
router.get('/:id', async (req, res, next) => {
  try {
    const prompt = await db('prompt_logs')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!prompt) {
      return res.status(404).json({ error: 'Prompt log not found' });
    }

    res.json({ prompt });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
