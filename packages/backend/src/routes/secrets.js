const express = require('express');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const { encrypt } = require('../utils/encryption');
const secretDetector = require('../services/secretDetector');

const router = express.Router();

// All routes require authentication
router.use(requireUser);

// Helper: verify user owns the project
async function verifyProjectOwnership(projectId, userId) {
  const project = await db('projects')
    .where({ id: projectId, user_id: userId })
    .first();
  return project;
}

// GET /:projectId - List secrets for a project (keys only, NOT values)
router.get('/:projectId', async (req, res, next) => {
  try {
    const project = await verifyProjectOwnership(req.params.projectId, req.user.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const secrets = await db('project_secrets')
      .where({ project_id: req.params.projectId })
      .select('id', 'key', 'type', 'description', 'created_at')
      .orderBy('key', 'asc');

    res.json({ secrets });
  } catch (err) {
    next(err);
  }
});

// POST /:projectId - Add/update a secret
router.post('/:projectId', async (req, res, next) => {
  try {
    const project = await verifyProjectOwnership(req.params.projectId, req.user.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { key, value, type, description } = req.body;

    if (!key || !value) {
      return res.status(400).json({ error: 'key and value are required' });
    }

    const encryptedValue = encrypt(value);

    const [secret] = await db('project_secrets')
      .insert({
        project_id: req.params.projectId,
        key,
        encrypted_value: encryptedValue,
        type: type || 'custom',
        description: description || null,
      })
      .onConflict(['project_id', 'key'])
      .merge({
        encrypted_value: encryptedValue,
        type: type || 'custom',
        description: description || null,
        updated_at: db.fn.now(),
      })
      .returning(['id', 'key', 'type', 'description']);

    res.status(201).json(secret);
  } catch (err) {
    next(err);
  }
});

// POST /:projectId/detect - Scan project files for required secrets
router.post('/:projectId/detect', async (req, res, next) => {
  try {
    const project = await verifyProjectOwnership(req.params.projectId, req.user.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Fetch all project files
    const files = await db('project_files')
      .where({ project_id: req.params.projectId })
      .select('file_path', 'content');

    // Scan each file for secrets
    const secretMap = new Map(); // key -> { key, type, reason, files[] }
    for (const file of files) {
      if (!file.content) continue;
      const detected = secretDetector.detectSecrets(file.content);
      for (const s of detected) {
        if (secretMap.has(s.key)) {
          const existing = secretMap.get(s.key);
          if (!existing.files.includes(file.file_path)) {
            existing.files.push(file.file_path);
          }
        } else {
          secretMap.set(s.key, { key: s.key, type: s.type, reason: s.reason, files: [file.file_path] });
        }
      }
    }

    // Filter out secrets already configured
    const existingSecrets = await db('project_secrets')
      .where({ project_id: req.params.projectId })
      .select('key');
    const existingKeys = new Set(existingSecrets.map((s) => s.key));

    const detected = [...secretMap.values()].filter((s) => !existingKeys.has(s.key));

    res.json({ detected });
  } catch (err) {
    next(err);
  }
});

// DELETE /:projectId/:secretId - Remove a secret
router.delete('/:projectId/:secretId', async (req, res, next) => {
  try {
    const project = await verifyProjectOwnership(req.params.projectId, req.user.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const deleted = await db('project_secrets')
      .where({ id: req.params.secretId, project_id: req.params.projectId })
      .del();

    if (!deleted) {
      return res.status(404).json({ error: 'Secret not found' });
    }

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
