require('dotenv').config({ path: require('path').resolve(__dirname, '../../../../.env') });

const config = {
  // Server
  port: parseInt(process.env.PORT, 10) || 3001,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',

  // PostgreSQL
  databaseUrl: process.env.DATABASE_URL,

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // Clerk Auth
  clerkPublishableKey: process.env.CLERK_PUBLISHABLE_KEY,
  clerkSecretKey: process.env.CLERK_SECRET_KEY,
  clerkWebhookSecret: process.env.CLERK_WEBHOOK_SECRET,

  // LLM Providers
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  fireworksApiKey: process.env.FIREWORKS_API_KEY,
  openaiApiKey: process.env.OPENAI_API_KEY,

  // GitHub OAuth
  githubClientId: process.env.GITHUB_CLIENT_ID,
  githubClientSecret: process.env.GITHUB_CLIENT_SECRET,

  // Railway
  railwayApiToken: process.env.RAILWAY_API_TOKEN,

  // Cloudflare
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN,
  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID,
  cloudflareKvNamespaceId: process.env.CLOUDFLARE_KV_NAMESPACE_ID,

  // AWS
  awsRegion: process.env.AWS_REGION || 'us-east-1',
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  s3BucketName: process.env.S3_BUCKET_NAME || 'imagia-assets',

  // Sentry
  sentryDsn: process.env.SENTRY_DSN,

  // Cache TTLs (seconds)
  cacheTtlLlm: parseInt(process.env.CACHE_TTL_LLM, 10) || 2592000,       // 30 days
  cacheTtlProjects: parseInt(process.env.CACHE_TTL_PROJECTS, 10) || 3600, // 1 hour

  // Rate Limiting
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,  // 15 min
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,

  // Circuit Breaker
  circuitBreakerTimeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT, 10) || 30000,
  circuitBreakerErrorThreshold: parseInt(process.env.CIRCUIT_BREAKER_ERROR_THRESHOLD, 10) || 50,
  circuitBreakerResetTimeout: parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT, 10) || 60000,

  // Frontend URL (for CORS)
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  // Secrets encryption
  secretsEncryptionKey: process.env.SECRETS_ENCRYPTION_KEY,

  // Social Media OAuth (Phase 5)
  twitterClientId: process.env.TWITTER_CLIENT_ID,
  twitterClientSecret: process.env.TWITTER_CLIENT_SECRET,
  linkedinClientId: process.env.LINKEDIN_CLIENT_ID,
  linkedinClientSecret: process.env.LINKEDIN_CLIENT_SECRET,
  facebookAppId: process.env.FACEBOOK_APP_ID,
  facebookAppSecret: process.env.FACEBOOK_APP_SECRET,
  socialOauthCallbackUrl: process.env.SOCIAL_OAUTH_CALLBACK_URL,

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
