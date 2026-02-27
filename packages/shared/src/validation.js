const Joi = require('joi');

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const schemas = {
  uuid: Joi.string().pattern(uuidPattern).required(),
  uuidOptional: Joi.string().pattern(uuidPattern).optional(),

  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),

  createProject: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    description: Joi.string().max(5000).optional(),
    app_type: Joi.string().valid('react-spa', 'next-app', 'express-api', 'static-site').optional(),
    settings: Joi.object().optional(),
  }),

  updateProject: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    description: Joi.string().max(5000).optional(),
    settings: Joi.object().optional(),
    status: Joi.string().valid('draft', 'archived').optional(),
  }),

  sendMessage: Joi.object({
    content: Joi.string().min(1).max(50000).required(),
    secrets: Joi.array().items(
      Joi.object({
        key: Joi.string().min(1).max(255).required(),
        value: Joi.string().min(1).max(10000).required(),
        type: Joi.string().valid('api_key', 'database_url', 'auth_token', 'webhook_secret', 'custom').default('custom'),
      })
    ).optional(),
  }),

  createSecret: Joi.object({
    key: Joi.string().min(1).max(255).required(),
    value: Joi.string().min(1).max(10000).required(),
    type: Joi.string().valid('api_key', 'database_url', 'auth_token', 'webhook_secret', 'custom').default('custom'),
    description: Joi.string().max(500).optional(),
  }),

  promptQuery: Joi.object({
    project_id: Joi.string().pattern(uuidPattern).optional(),
    task_type: Joi.string().optional(),
    provider: Joi.string().valid('anthropic', 'fireworks', 'openai').optional(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

module.exports = { schemas };
