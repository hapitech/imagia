const express = require('express');
const Joi = require('joi');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const { validate } = require('../middleware/requestValidator');
const githubService = require('../services/githubService');
const logger = require('../config/logger');

const router = express.Router();
router.use(requireUser);

// Validation schemas
const importSchema = Joi.object({
  repo_full_name: Joi.string()
    .pattern(/^[^/]+\/[^/]+$/)
    .required()
    .messages({ 'string.pattern.base': 'repo_full_name must be in "owner/repo" format' }),
  project_name: Joi.string().trim().max(255).optional(),
});

const pushSchema = Joi.object({
  commit_message: Joi.string().trim().max(500).default('Update from Imagia'),
});

const createRepoSchema = Joi.object({
  repo_name: Joi.string()
    .trim()
    .pattern(/^[a-zA-Z0-9._-]+$/)
    .max(100)
    .required(),
  is_private: Joi.boolean().default(false),
});

// GET /repos - List user's GitHub repos
router.get('/repos', async (req, res, next) => {
  try {
    const { page = 1, per_page = 30 } = req.query;
    const repos = await githubService.listRepos(req.user.id, {
      page: parseInt(page, 10),
      perPage: parseInt(per_page, 10),
    });
    res.json({ repos });
  } catch (err) {
    if (err.message.includes('not connected')) {
      return res.status(403).json({ error: err.message });
    }
    next(err);
  }
});

// POST /import - Import an existing repo as a new project
router.post('/import', validate(importSchema), async (req, res, next) => {
  try {
    const { repo_full_name, project_name } = req.body;

    logger.info('Importing repo', {
      userId: req.user.id,
      repo: repo_full_name,
    });

    // Import repo contents
    const importResult = await githubService.importRepo(req.user.id, repo_full_name);

    // Create project
    const [project] = await db('projects')
      .insert({
        user_id: req.user.id,
        name: project_name || importResult.repoInfo.full_name.split('/')[1],
        description: importResult.repoInfo.description || `Imported from ${repo_full_name}`,
        status: 'ready',
        app_type: importResult.repoInfo.language || 'other',
        github_repo_url: `https://github.com/${repo_full_name}`,
        github_repo_owner: repo_full_name.split('/')[0],
        github_repo_name: repo_full_name.split('/')[1],
        github_branch: importResult.repoInfo.default_branch,
      })
      .returning('*');

    // Save files
    if (importResult.files.length > 0) {
      await db('project_files').insert(
        importResult.files.map((f) => ({
          project_id: project.id,
          file_path: f.file_path,
          content: f.content,
          language: f.language,
        }))
      );
    }

    // Create github_connections record
    await db('github_connections').insert({
      project_id: project.id,
      repo_full_name,
      default_branch: importResult.repoInfo.default_branch,
      last_commit_sha: importResult.latestCommitSha,
      last_synced_at: db.fn.now(),
      sync_status: 'synced',
    });

    // Create default conversation
    await db('conversations').insert({
      project_id: project.id,
      title: 'Main',
    });

    res.status(201).json({
      project,
      files_imported: importResult.fetchedFiles,
      total_files: importResult.totalFiles,
    });
  } catch (err) {
    if (err.message.includes('not connected')) {
      return res.status(403).json({ error: err.message });
    }
    next(err);
  }
});

// POST /projects/:id/push - Push project code to GitHub
router.post('/projects/:id/push', validate(pushSchema), async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = await githubService.pushToGitHub(
      req.user.id,
      req.params.id,
      req.body.commit_message
    );

    res.json({
      message: 'Code pushed to GitHub',
      commit_sha: result.commitSha,
      commit_url: result.commitUrl,
    });
  } catch (err) {
    if (err.message.includes('not connected') || err.message.includes('No GitHub connection')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /projects/:id/pull - Pull latest from GitHub
router.post('/projects/:id/pull', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const result = await githubService.pullFromGitHub(req.user.id, req.params.id);

    res.json({
      message: 'Code pulled from GitHub',
      file_count: result.fileCount,
      commit_sha: result.commitSha,
    });
  } catch (err) {
    if (err.message.includes('No GitHub connection')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

// POST /projects/:id/create-repo - Create new GitHub repo from project
router.post('/projects/:id/create-repo', validate(createRepoSchema), async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check if already connected
    const existing = await db('github_connections')
      .where({ project_id: req.params.id })
      .first();

    if (existing) {
      return res.status(409).json({
        error: 'Project already connected to a GitHub repo',
        repo: existing.repo_full_name,
      });
    }

    const result = await githubService.createRepo(
      req.user.id,
      req.params.id,
      req.body.repo_name,
      req.body.is_private
    );

    res.status(201).json({
      message: 'GitHub repo created and code pushed',
      repo: result,
    });
  } catch (err) {
    if (err.message.includes('not connected')) {
      return res.status(403).json({ error: err.message });
    }
    next(err);
  }
});

// GET /projects/:id/sync-status - Check sync status
router.get('/projects/:id/sync-status', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const status = await githubService.syncStatus(req.user.id, req.params.id);
    res.json(status);
  } catch (err) {
    next(err);
  }
});

// DELETE /projects/:id/disconnect - Disconnect GitHub from project
router.delete('/projects/:id/disconnect', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    await db('github_connections').where({ project_id: req.params.id }).del();

    await db('projects').where({ id: req.params.id }).update({
      github_repo_url: null,
      github_repo_owner: null,
      github_repo_name: null,
      github_branch: null,
      updated_at: db.fn.now(),
    });

    res.json({ message: 'GitHub disconnected' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
