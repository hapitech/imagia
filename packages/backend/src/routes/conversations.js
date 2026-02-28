const express = require('express');
const Joi = require('joi');
const { db } = require('../config/database');
const { requireUser } = require('../middleware/auth');
const { validate } = require('../middleware/requestValidator');
const { encrypt } = require('../utils/encryption');
const secretDetector = require('../services/secretDetector');
const urlExtractor = require('../services/urlExtractor');
const buildQueue = require('../queues/buildQueue');

const router = express.Router();

// All routes require authentication
router.use(requireUser);

// Validation schemas
const createConversationSchema = Joi.object({
  project_id: Joi.string().uuid().required(),
  title: Joi.string().trim().max(255).allow('', null),
});

const sendMessageSchema = Joi.object({
  content: Joi.string().trim().min(1).required(),
  model: Joi.string().trim().max(255).optional(), // LLM model override (e.g. 'auto' or model_id)
  secrets: Joi.array()
    .items(
      Joi.object({
        key: Joi.string().trim().required(),
        value: Joi.string().required(),
        type: Joi.string().trim().max(50).default('custom'),
      })
    )
    .optional(),
  attachment_ids: Joi.array().items(Joi.string().uuid()).optional(),
});

// Helper: verify user owns the project
async function verifyProjectOwnership(projectId, userId) {
  const project = await db('projects')
    .where({ id: projectId, user_id: userId })
    .first();
  return project;
}

// GET / - List conversations for a project
router.get('/', async (req, res, next) => {
  try {
    const { project_id } = req.query;

    if (!project_id) {
      return res.status(400).json({ error: 'project_id query parameter is required' });
    }

    const project = await verifyProjectOwnership(project_id, req.user.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const conversations = await db('conversations')
      .where({ project_id })
      .orderBy('created_at', 'desc');

    res.json({ conversations });
  } catch (err) {
    next(err);
  }
});

// POST / - Create conversation
router.post('/', validate(createConversationSchema), async (req, res, next) => {
  try {
    const { project_id, title } = req.body;

    const project = await verifyProjectOwnership(project_id, req.user.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const [conversation] = await db('conversations')
      .insert({
        project_id,
        title: title || null,
      })
      .returning('*');

    res.status(201).json({ conversation });
  } catch (err) {
    next(err);
  }
});

// GET /:id/messages - Get messages
router.get('/:id/messages', async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;

    // Verify ownership through the conversation's project
    const conversation = await db('conversations')
      .where({ id: req.params.id })
      .first();

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const project = await verifyProjectOwnership(conversation.project_id, req.user.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const [{ count }] = await db('messages')
      .where({ conversation_id: req.params.id })
      .count('* as count');
    const total = parseInt(count, 10);

    const messages = await db('messages')
      .where({ conversation_id: req.params.id })
      .orderBy('created_at', 'asc')
      .limit(limitNum)
      .offset(offset);

    // Fetch attachments for all messages in this page
    const messageIds = messages.map((m) => m.id);
    const allAttachments = messageIds.length > 0
      ? await db('message_attachments').whereIn('message_id', messageIds)
      : [];

    const attachmentsByMessage = {};
    for (const att of allAttachments) {
      if (!attachmentsByMessage[att.message_id]) {
        attachmentsByMessage[att.message_id] = [];
      }
      attachmentsByMessage[att.message_id].push(att);
    }

    const messagesWithAttachments = messages.map((m) => ({
      ...m,
      attachments: attachmentsByMessage[m.id] || [],
    }));

    res.json({
      messages: messagesWithAttachments,
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

// POST /:id/messages - Send message
router.post('/:id/messages', validate(sendMessageSchema), async (req, res, next) => {
  try {
    const { content, model, secrets, attachment_ids } = req.body;

    // Verify ownership through the conversation's project
    const conversation = await db('conversations')
      .where({ id: req.params.id })
      .first();

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const project = await verifyProjectOwnership(conversation.project_id, req.user.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Store secrets if provided
    if (secrets && secrets.length > 0) {
      for (const secret of secrets) {
        const encryptedValue = encrypt(secret.value);
        await db('project_secrets')
          .insert({
            project_id: conversation.project_id,
            key: secret.key,
            encrypted_value: encryptedValue,
            type: secret.type || 'custom',
          })
          .onConflict(['project_id', 'key'])
          .merge({
            encrypted_value: encryptedValue,
            type: secret.type || 'custom',
            updated_at: db.fn.now(),
          });
      }
    }

    // Extract URLs from the message content (non-blocking for response)
    const detectedUrls = urlExtractor.detectUrls(content);
    let urlExtractions = [];
    if (detectedUrls.length > 0) {
      const { extractions } = await urlExtractor.extractUrlsFromMessage(content);
      urlExtractions = extractions;
    }

    // Store user message with URL extractions in metadata
    const messageMetadata = {};
    if (urlExtractions.length > 0) {
      messageMetadata.url_extractions = urlExtractions.map((e) => ({
        url: e.url,
        title: e.title,
        description: e.description,
        content: e.content,
      }));
    }

    const [message] = await db('messages')
      .insert({
        conversation_id: req.params.id,
        role: 'user',
        content,
        metadata: JSON.stringify(messageMetadata),
      })
      .returning('*');

    // Link pending attachments to this message
    let attachments = [];
    if (attachment_ids && attachment_ids.length > 0) {
      await db('message_attachments')
        .whereIn('id', attachment_ids)
        .where({ project_id: conversation.project_id, message_id: null })
        .update({ message_id: message.id, updated_at: db.fn.now() });

      attachments = await db('message_attachments')
        .whereIn('id', attachment_ids)
        .where({ message_id: message.id });
    }

    // Update message count
    await db('conversations')
      .where({ id: req.params.id })
      .increment('message_count', 1);

    // Detect if secrets are needed from message content
    const existingSecrets = await db('project_secrets')
      .where({ project_id: conversation.project_id })
      .select('key');
    const existingKeys = existingSecrets.map((s) => s.key);

    const detectedSecrets = secretDetector.detectSecrets(content);
    const missingSecrets = detectedSecrets.filter((s) => !existingKeys.includes(s.key));

    if (missingSecrets.length > 0) {
      return res.status(200).json({
        message: { ...message, attachments },
        detected_secrets: missingSecrets,
        extracted_urls: urlExtractions.map((e) => ({ url: e.url, title: e.title })),
      });
    }

    // Queue build job
    const job = await buildQueue.add({
      projectId: conversation.project_id,
      conversationId: conversation.id,
      messageId: message.id,
      model: model || 'auto',
    });

    res.status(200).json({
      message: { ...message, attachments },
      job_id: job.id,
      extracted_urls: urlExtractions.map((e) => ({ url: e.url, title: e.title })),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
