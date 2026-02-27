const express = require('express');
const crypto = require('crypto');
const Joi = require('joi');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const socialService = require('../services/socialService');
const socialQueue = require('../queues/socialQueue');

const router = express.Router();

router.use(requireUser);

// ---------- OAuth flows --------------------------------------------------------

// POST /oauth/authorize/:platform - Get OAuth URL
router.post('/oauth/authorize/:platform', async (req, res, next) => {
  try {
    const { platform } = req.params;
    const validPlatforms = ['twitter', 'linkedin', 'instagram', 'facebook'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ error: `Invalid platform. Must be one of: ${validPlatforms.join(', ')}` });
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');
    // Store state in a short-lived cache (simple approach: include userId)
    const statePayload = Buffer.from(JSON.stringify({ userId: req.user.id, ts: Date.now() })).toString('base64url');
    const fullState = `${state}.${statePayload}`;

    const url = socialService.getOAuthUrl(platform, fullState);

    res.json({ url, state: fullState });
  } catch (err) {
    next(err);
  }
});

// POST /oauth/callback/:platform - Handle OAuth callback
router.post('/oauth/callback/:platform', async (req, res, next) => {
  try {
    const { platform } = req.params;
    const { code, state } = req.body;

    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    // Validate state
    if (state) {
      try {
        const [, payload] = state.split('.');
        const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString());
        if (parsed.userId !== req.user.id) {
          return res.status(403).json({ error: 'State mismatch' });
        }
        // Check state is not older than 10 minutes
        if (Date.now() - parsed.ts > 10 * 60 * 1000) {
          return res.status(400).json({ error: 'State expired' });
        }
      } catch {
        return res.status(400).json({ error: 'Invalid state' });
      }
    }

    const account = await socialService.handleOAuthCallback(platform, code, req.user.id);

    res.json({ account });
  } catch (err) {
    next(err);
  }
});

// ---------- Account management -------------------------------------------------

// GET /accounts - List connected social accounts
router.get('/accounts', async (req, res, next) => {
  try {
    const accounts = await socialService.getAccounts(req.user.id);
    res.json({ accounts });
  } catch (err) {
    next(err);
  }
});

// DELETE /accounts/:accountId - Disconnect account
router.delete('/accounts/:accountId', async (req, res, next) => {
  try {
    await socialService.disconnectAccount(req.user.id, req.params.accountId);
    res.json({ success: true });
  } catch (err) {
    if (err.message === 'Account not found') {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

// ---------- Post scheduling ----------------------------------------------------

const schedulePostSchema = Joi.object({
  project_id: Joi.string().uuid().allow(null).optional(),
  social_account_id: Joi.string().uuid().required(),
  content: Joi.string().trim().min(1).max(65000).required(),
  media_urls: Joi.array().items(Joi.string().uri()).max(10).optional(),
  scheduled_at: Joi.date().iso().min('now').allow(null).optional(),
});

// POST /posts - Schedule or draft a new post
router.post('/posts', async (req, res, next) => {
  try {
    const { error, value } = schedulePostSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }

    const post = await socialService.schedulePost({
      userId: req.user.id,
      projectId: value.project_id,
      socialAccountId: value.social_account_id,
      content: value.content,
      mediaUrls: value.media_urls,
      scheduledAt: value.scheduled_at,
    });

    res.status(201).json({ post });
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('limit') || err.message.includes('expired')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// GET /posts - List posts (with optional filters)
router.get('/posts', async (req, res, next) => {
  try {
    const { project_id, status, page, limit } = req.query;

    const result = await socialService.getPosts(req.user.id, {
      projectId: project_id,
      status,
      page: parseInt(page, 10) || 1,
      limit: Math.min(100, parseInt(limit, 10) || 20),
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// PATCH /posts/:postId - Update a draft/scheduled post
router.patch('/posts/:postId', async (req, res, next) => {
  try {
    const updates = {};
    if (req.body.content !== undefined) updates.content = req.body.content;
    if (req.body.media_urls !== undefined) updates.media_urls = req.body.media_urls;
    if (req.body.scheduled_at !== undefined) updates.scheduled_at = req.body.scheduled_at;

    const post = await socialService.updatePost(req.user.id, req.params.postId, updates);

    res.json({ post });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Cannot')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// DELETE /posts/:postId - Delete a post
router.delete('/posts/:postId', async (req, res, next) => {
  try {
    await socialService.deletePost(req.user.id, req.params.postId);
    res.json({ success: true });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    if (err.message.includes('Cannot')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /posts/:postId/publish - Publish a post immediately
router.post('/posts/:postId/publish', async (req, res, next) => {
  try {
    const post = await socialService.publishNow(req.user.id, req.params.postId);

    // Queue the publish job
    await socialQueue.add('publish', { postId: post.id }, { priority: 1 });

    res.json({ success: true, message: 'Post queued for publishing' });
  } catch (err) {
    if (err.message.includes('not found') || err.message.includes('already')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /posts/:postId/engagement - Refresh engagement metrics
router.post('/posts/:postId/engagement', async (req, res, next) => {
  try {
    const engagement = await socialService.fetchEngagement(req.params.postId);
    if (!engagement) {
      return res.status(404).json({ error: 'Post not found or not yet published' });
    }
    res.json({ engagement });
  } catch (err) {
    next(err);
  }
});

// ---------- Validation helper --------------------------------------------------

// POST /validate - Validate post content for a platform
router.post('/validate', (req, res) => {
  const { content, platform } = req.body;
  if (!platform || !content) {
    return res.status(400).json({ error: 'content and platform are required' });
  }
  const result = socialService.validatePostContent(content, platform);
  res.json(result);
});

// ---------- Platform limits info -----------------------------------------------

// GET /platforms - Get supported platforms and their limits
router.get('/platforms', (req, res) => {
  res.json({ platforms: socialService.PLATFORM_LIMITS });
});

module.exports = router;
