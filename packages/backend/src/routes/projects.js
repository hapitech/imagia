const express = require('express');
const Joi = require('joi');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const { validate } = require('../middleware/requestValidator');

const router = express.Router();

// All routes require authentication
router.use(requireUser);

// Validation schemas
const createProjectSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255).required(),
  description: Joi.string().trim().max(5000).allow('', null),
  app_type: Joi.string().trim().max(100).allow('', null),
  settings: Joi.object().default({}),
});

const updateProjectSchema = Joi.object({
  name: Joi.string().trim().min(1).max(255),
  description: Joi.string().trim().max(5000).allow('', null),
  settings: Joi.object(),
  status: Joi.string().trim().max(50),
}).min(1);

// GET / - List user's projects
router.get('/', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const query = db('projects').where({ user_id: req.user.id });

    if (status) {
      query.andWhere({ status });
    }

    const [{ count }] = await query.clone().count('* as count');
    const total = parseInt(count, 10);

    const projects = await query
      .select('*')
      .orderBy('created_at', 'desc')
      .limit(limitNum)
      .offset(offset);

    res.json({
      projects,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST / - Create project
router.post('/', validate(createProjectSchema), async (req, res, next) => {
  try {
    const { name, description, app_type, settings } = req.body;

    const [project] = await db('projects')
      .insert({
        user_id: req.user.id,
        name,
        description: description || null,
        app_type: app_type || null,
        settings: JSON.stringify(settings || {}),
      })
      .returning('*');

    // Create a default conversation for the project
    await db('conversations').insert({
      project_id: project.id,
      title: 'Main',
    });

    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

// GET /:id - Get project
router.get('/:id', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get file count
    const [{ count: fileCount }] = await db('project_files')
      .where({ project_id: project.id })
      .count('* as count');

    // Get latest version
    const latestVersion = await db('project_versions')
      .where({ project_id: project.id })
      .orderBy('version_number', 'desc')
      .first();

    res.json({
      project: {
        ...project,
        file_count: parseInt(fileCount, 10),
        latest_version: latestVersion || null,
      },
    });
  } catch (err) {
    next(err);
  }
});

// PATCH /:id - Update project
router.patch('/:id', validate(updateProjectSchema), async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const updates = {};
    const allowedFields = ['name', 'description', 'settings', 'status'];
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = field === 'settings' ? JSON.stringify(req.body[field]) : req.body[field];
      }
    }
    updates.updated_at = db.fn.now();

    const [updated] = await db('projects')
      .where({ id: req.params.id })
      .update(updates)
      .returning('*');

    res.json({ project: updated });
  } catch (err) {
    next(err);
  }
});

// DELETE /:id - Delete project
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .del();

    if (!deleted) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /:id/files - Get project files
router.get('/:id/files', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const files = await db('project_files')
      .where({ project_id: project.id })
      .select('id', 'file_path', 'language', 'file_size', 'checksum', 'created_at', 'updated_at')
      .orderBy('file_path', 'asc');

    res.json({ files });
  } catch (err) {
    next(err);
  }
});

// GET /:id/versions - List versions
router.get('/:id/versions', async (req, res, next) => {
  try {
    const project = await db('projects')
      .where({ id: req.params.id, user_id: req.user.id })
      .first();

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const versions = await db('project_versions')
      .where({ project_id: project.id })
      .orderBy('version_number', 'desc');

    res.json({ versions });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
