const express = require('express');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const modelRegistry = require('../services/modelRegistry');
const requestAnalyzer = require('../services/requestAnalyzer');

const router = express.Router();

// All routes require authentication
router.use(requireUser);

/**
 * GET / - Get available models grouped by capability.
 * Used by the frontend model selector dropdown.
 */
router.get('/', async (req, res, next) => {
  try {
    const grouped = await modelRegistry.getModelsGrouped();
    res.json({ models: grouped });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /recommend - Analyze a message and recommend a model.
 * Query: ?message=build+a+todo+app
 */
router.get('/recommend', async (req, res, next) => {
  try {
    const { message } = req.query;

    if (!message) {
      return res.status(400).json({ error: 'message query parameter is required' });
    }

    const recommendation = await requestAnalyzer.analyze(message);

    res.json({
      capability: recommendation.capability,
      recommendedModel: recommendation.recommendedModel
        ? {
            id: recommendation.recommendedModel.model_id,
            provider: recommendation.recommendedModel.provider,
            displayName: recommendation.recommendedModel.display_name,
          }
        : null,
      confidence: recommendation.confidence,
      alternativeModel: recommendation.alternativeModel
        ? {
            id: recommendation.alternativeModel.model_id,
            provider: recommendation.alternativeModel.provider,
            displayName: recommendation.alternativeModel.display_name,
          }
        : undefined,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /research-log - Get recent model research cron results.
 */
router.get('/research-log', async (req, res, next) => {
  try {
    const logs = await db('model_research_logs')
      .orderBy('run_at', 'desc')
      .limit(20);

    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
