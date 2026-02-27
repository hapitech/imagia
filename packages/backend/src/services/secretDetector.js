/**
 * Secret Detector
 *
 * Scans content (prompts or generated code) for references to secrets,
 * API keys, database URLs, and other credentials that would need to be
 * configured as environment variables.
 *
 * Uses regex patterns only -- no LLM calls.
 */

// Patterns for detecting process.env references
const ENV_VAR_PATTERN = /process\.env\.([A-Z][A-Z0-9_]+)/g;

// Patterns for detecting placeholder API keys
const PLACEHOLDER_PATTERNS = [
  {
    pattern: /['"]sk-[a-zA-Z0-9]{20,}['"]/g,
    type: 'api_key',
    service: 'OpenAI/Stripe',
    keyName: 'OPENAI_API_KEY',
  },
  {
    pattern: /['"]pk_(?:live|test)_[a-zA-Z0-9]+['"]/g,
    type: 'api_key',
    service: 'Stripe',
    keyName: 'STRIPE_PUBLISHABLE_KEY',
  },
  {
    pattern: /['"]sk_(?:live|test)_[a-zA-Z0-9]+['"]/g,
    type: 'api_key',
    service: 'Stripe',
    keyName: 'STRIPE_SECRET_KEY',
  },
  {
    pattern: /['"]your[-_]?api[-_]?key[-_]?here['"]/gi,
    type: 'api_key',
    service: 'generic',
    keyName: 'API_KEY',
  },
  {
    pattern: /['"](?:xxx+|placeholder|REPLACE_ME|INSERT_KEY_HERE|TODO)['"]/gi,
    type: 'api_key',
    service: 'generic',
    keyName: 'API_KEY',
  },
  {
    pattern: /['"]SG\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+['"]/g,
    type: 'api_key',
    service: 'SendGrid',
    keyName: 'SENDGRID_API_KEY',
  },
  {
    pattern: /['"]AC[a-f0-9]{32}['"]/g,
    type: 'api_key',
    service: 'Twilio',
    keyName: 'TWILIO_ACCOUNT_SID',
  },
  {
    pattern: /['"]xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+['"]/g,
    type: 'api_key',
    service: 'Slack',
    keyName: 'SLACK_BOT_TOKEN',
  },
  {
    pattern: /['"]ghp_[a-zA-Z0-9]{36}['"]/g,
    type: 'api_key',
    service: 'GitHub',
    keyName: 'GITHUB_TOKEN',
  },
];

// Patterns for detecting database URLs
const DATABASE_URL_PATTERNS = [
  {
    pattern: /postgres(?:ql)?:\/\/[^\s'"]+/gi,
    type: 'database_url',
    keyName: 'DATABASE_URL',
    reason: 'Found PostgreSQL connection string',
  },
  {
    pattern: /mongodb(?:\+srv)?:\/\/[^\s'"]+/gi,
    type: 'database_url',
    keyName: 'MONGODB_URI',
    reason: 'Found MongoDB connection string',
  },
  {
    pattern: /mysql:\/\/[^\s'"]+/gi,
    type: 'database_url',
    keyName: 'MYSQL_URL',
    reason: 'Found MySQL connection string',
  },
  {
    pattern: /redis:\/\/[^\s'"]+/gi,
    type: 'connection_url',
    keyName: 'REDIS_URL',
    reason: 'Found Redis connection string',
  },
];

// Known service keyword patterns (detects references to services that need API keys)
const SERVICE_PATTERNS = [
  { pattern: /\bstripe\b/i, keyName: 'STRIPE_SECRET_KEY', service: 'Stripe', type: 'api_key' },
  { pattern: /\btwilio\b/i, keyName: 'TWILIO_AUTH_TOKEN', service: 'Twilio', type: 'api_key' },
  { pattern: /\bsendgrid\b/i, keyName: 'SENDGRID_API_KEY', service: 'SendGrid', type: 'api_key' },
  { pattern: /\bmailgun\b/i, keyName: 'MAILGUN_API_KEY', service: 'Mailgun', type: 'api_key' },
  { pattern: /\baws\b/i, keyName: 'AWS_ACCESS_KEY_ID', service: 'AWS', type: 'api_key' },
  { pattern: /\bgoogle[_\s]?cloud\b/i, keyName: 'GOOGLE_CLOUD_KEY', service: 'Google Cloud', type: 'api_key' },
  { pattern: /\bfirebase\b/i, keyName: 'FIREBASE_API_KEY', service: 'Firebase', type: 'api_key' },
  { pattern: /\balgolia\b/i, keyName: 'ALGOLIA_API_KEY', service: 'Algolia', type: 'api_key' },
  { pattern: /\bcloudinary\b/i, keyName: 'CLOUDINARY_API_KEY', service: 'Cloudinary', type: 'api_key' },
  { pattern: /\bsentry\b/i, keyName: 'SENTRY_DSN', service: 'Sentry', type: 'dsn' },
  { pattern: /\bpusher\b/i, keyName: 'PUSHER_APP_KEY', service: 'Pusher', type: 'api_key' },
  { pattern: /\bplaid\b/i, keyName: 'PLAID_SECRET', service: 'Plaid', type: 'api_key' },
  { pattern: /\bresend\b/i, keyName: 'RESEND_API_KEY', service: 'Resend', type: 'api_key' },
  { pattern: /\bpostmark\b/i, keyName: 'POSTMARK_API_TOKEN', service: 'Postmark', type: 'api_key' },
];

// Patterns for detecting common secret variable names in code
const SECRET_NAME_PATTERNS = [
  /(?:API|ACCESS|AUTH|SECRET|PRIVATE)[-_]?KEY/gi,
  /(?:API|ACCESS|AUTH|SECRET|PRIVATE)[-_]?TOKEN/gi,
  /(?:DB|DATABASE)[-_]?(?:PASSWORD|PASS|URL|URI|CONNECTION)/gi,
  /(?:JWT|SESSION)[-_]?SECRET/gi,
  /ENCRYPTION[-_]?KEY/gi,
  /WEBHOOK[-_]?SECRET/gi,
  /CLIENT[-_]?SECRET/gi,
];

class SecretDetector {
  /**
   * Detect secrets, API keys, and credentials referenced in content.
   *
   * @param {string} content - The text to scan (prompt, code, etc.)
   * @returns {Array<{key: string, type: string, reason: string}>}
   */
  detectSecrets(content) {
    if (!content || typeof content !== 'string') {
      return [];
    }

    const detected = new Map(); // Use Map to deduplicate by key name

    // 1. Detect process.env references
    this._detectEnvVars(content, detected);

    // 2. Detect placeholder API keys
    this._detectPlaceholders(content, detected);

    // 3. Detect database URLs
    this._detectDatabaseUrls(content, detected);

    // 4. Detect known service references
    this._detectServiceReferences(content, detected);

    // 5. Detect generic secret variable name patterns
    this._detectSecretNames(content, detected);

    return Array.from(detected.values());
  }

  /**
   * Scan for process.env.SOME_KEY references.
   * @private
   */
  _detectEnvVars(content, detected) {
    let match;
    const pattern = new RegExp(ENV_VAR_PATTERN.source, ENV_VAR_PATTERN.flags);

    while ((match = pattern.exec(content)) !== null) {
      const envName = match[1];

      // Skip common non-secret env vars
      if (this._isNonSecret(envName)) {
        continue;
      }

      const type = this._inferType(envName);

      detected.set(envName, {
        key: envName,
        type,
        reason: `Found reference to process.env.${envName}`,
      });
    }
  }

  /**
   * Scan for placeholder API key values.
   * @private
   */
  _detectPlaceholders(content, detected) {
    for (const { pattern, type, service, keyName } of PLACEHOLDER_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);

      if (regex.test(content)) {
        if (!detected.has(keyName)) {
          detected.set(keyName, {
            key: keyName,
            type,
            reason: `Found ${service} API key placeholder`,
          });
        }
      }
    }
  }

  /**
   * Scan for database connection URLs.
   * @private
   */
  _detectDatabaseUrls(content, detected) {
    for (const { pattern, type, keyName, reason } of DATABASE_URL_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);

      if (regex.test(content)) {
        if (!detected.has(keyName)) {
          detected.set(keyName, {
            key: keyName,
            type,
            reason,
          });
        }
      }
    }
  }

  /**
   * Scan for references to known services that need API keys.
   * @private
   */
  _detectServiceReferences(content, detected) {
    for (const { pattern, keyName, service, type } of SERVICE_PATTERNS) {
      if (pattern.test(content)) {
        if (!detected.has(keyName)) {
          detected.set(keyName, {
            key: keyName,
            type,
            reason: `Found reference to ${service} service`,
          });
        }
      }
    }
  }

  /**
   * Scan for generic secret-like variable names.
   * @private
   */
  _detectSecretNames(content, detected) {
    for (const pattern of SECRET_NAME_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;

      while ((match = regex.exec(content)) !== null) {
        const name = match[0].toUpperCase().replace(/-/g, '_');

        // Avoid duplicating already-detected keys
        if (!detected.has(name)) {
          detected.set(name, {
            key: name,
            type: this._inferType(name),
            reason: `Found secret-like variable name: ${match[0]}`,
          });
        }
      }
    }
  }

  /**
   * Check if an env var name is a non-secret (e.g. PORT, NODE_ENV).
   * @private
   */
  _isNonSecret(name) {
    const nonSecrets = new Set([
      'PORT',
      'HOST',
      'NODE_ENV',
      'LOG_LEVEL',
      'TZ',
      'LANG',
      'HOME',
      'PATH',
      'PWD',
      'SHELL',
      'USER',
      'TERM',
      'CI',
      'FRONTEND_URL',
      'BACKEND_URL',
      'APP_URL',
      'BASE_URL',
      'API_URL',
      'CORS_ORIGIN',
    ]);

    return nonSecrets.has(name);
  }

  /**
   * Infer the type of a secret from its name.
   * @private
   */
  _inferType(name) {
    const upper = name.toUpperCase();

    if (upper.includes('DATABASE') || upper.includes('DB_URL') || upper.includes('DB_URI')) {
      return 'database_url';
    }
    if (upper.includes('REDIS')) {
      return 'connection_url';
    }
    if (upper.includes('DSN')) {
      return 'dsn';
    }
    if (upper.includes('SECRET') || upper.includes('PRIVATE')) {
      return 'secret';
    }
    if (upper.includes('TOKEN')) {
      return 'token';
    }
    if (upper.includes('PASSWORD') || upper.includes('PASS')) {
      return 'password';
    }
    if (upper.includes('KEY') || upper.includes('API')) {
      return 'api_key';
    }
    if (upper.includes('WEBHOOK')) {
      return 'webhook_secret';
    }
    if (upper.includes('ENCRYPTION')) {
      return 'encryption_key';
    }

    return 'credential';
  }
}

// Singleton instance
const secretDetector = new SecretDetector();

module.exports = secretDetector;
