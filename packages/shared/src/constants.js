const PROJECT_STATUS = {
  DRAFT: 'draft',
  BUILDING: 'building',
  DEPLOYING: 'deploying',
  DEPLOYED: 'deployed',
  FAILED: 'failed',
  ARCHIVED: 'archived',
};

const APP_TYPES = {
  REACT_SPA: 'react-spa',
  NEXT_APP: 'next-app',
  EXPRESS_API: 'express-api',
  STATIC_SITE: 'static-site',
};

const LLM_PROVIDERS = {
  ANTHROPIC: 'anthropic',
  FIREWORKS: 'fireworks',
  OPENAI: 'openai',
};

const TASK_TYPES = {
  CODE_GENERATION: 'code-generation',
  CODE_ITERATION: 'code-iteration',
  CODE_REVIEW: 'code-review',
  SCAFFOLD: 'scaffold',
  PACKAGE_JSON: 'package-json',
  CONFIG_FILES: 'config-files',
  LANDING_PAGE: 'landing-page',
  SOCIAL_COPY: 'social-copy',
  AD_COPY: 'ad-copy',
  EMAIL_TEMPLATE: 'email-template',
  DEMO_SCRIPT: 'demo-script',
};

const ASSET_TYPES = {
  SCREENSHOT: 'screenshot',
  VIDEO_DEMO: 'video_demo',
  LANDING_PAGE: 'landing_page',
  SOCIAL_POST: 'social_post',
  AD_COPY: 'ad_copy',
  EMAIL_TEMPLATE: 'email_template',
};

const DEPLOYMENT_STATUS = {
  PENDING: 'pending',
  BUILDING: 'building',
  DEPLOYING: 'deploying',
  ACTIVE: 'active',
  FAILED: 'failed',
  STOPPED: 'stopped',
};

const SOCIAL_PLATFORMS = {
  TWITTER: 'twitter',
  LINKEDIN: 'linkedin',
  INSTAGRAM: 'instagram',
  FACEBOOK: 'facebook',
};

const MESSAGE_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
};

const PROMPT_STATUS = {
  SUCCESS: 'success',
  ERROR: 'error',
  TIMEOUT: 'timeout',
  CACHE_HIT: 'cache_hit',
};

const SECRET_TYPES = {
  API_KEY: 'api_key',
  DATABASE_URL: 'database_url',
  AUTH_TOKEN: 'auth_token',
  WEBHOOK_SECRET: 'webhook_secret',
  CUSTOM: 'custom',
};

module.exports = {
  PROJECT_STATUS,
  APP_TYPES,
  LLM_PROVIDERS,
  TASK_TYPES,
  ASSET_TYPES,
  DEPLOYMENT_STATUS,
  SOCIAL_PLATFORMS,
  MESSAGE_ROLES,
  PROMPT_STATUS,
  SECRET_TYPES,
};
