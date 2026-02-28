const claudeService = require('./claudeService');
const fireworksService = require('./fireworksService');
const openaiService = require('./openaiService');
const logger = require('../config/logger');

/**
 * Routing table mapping task types to primary and fallback LLM providers.
 */
const ROUTING_TABLE = {
  'code-generation': {
    primary: 'anthropic',
    model: 'claude-sonnet-4-6',
    fallback: 'openai',
  },
  'code-iteration': {
    primary: 'anthropic',
    model: 'claude-sonnet-4-6',
    fallback: 'openai',
  },
  'scaffold': {
    primary: 'anthropic',
    model: 'claude-sonnet-4-6',
    fallback: 'fireworks',
  },
  'config-files': {
    primary: 'anthropic',
    model: 'claude-sonnet-4-6',
    fallback: 'fireworks',
  },
  'landing-page': {
    primary: 'openai',
    model: 'gpt-4o',
    fallback: 'anthropic',
  },
  'social-copy': {
    primary: 'openai',
    model: 'gpt-4o',
    fallback: 'anthropic',
  },
  'ad-copy': {
    primary: 'openai',
    model: 'gpt-4o',
    fallback: 'anthropic',
  },
  'email-template': {
    primary: 'openai',
    model: 'gpt-4o',
    fallback: 'anthropic',
  },
  'demo-script': {
    primary: 'anthropic',
    model: 'claude-sonnet-4-6',
    fallback: 'openai',
  },
};

class LLMRouter {
  constructor() {
    this.providers = {
      anthropic: claudeService,
      fireworks: fireworksService,
      openai: openaiService,
    };

    logger.info('LLMRouter initialized', {
      taskTypes: Object.keys(ROUTING_TABLE),
    });
  }

  /**
   * Route a request to the appropriate LLM provider based on task type.
   * If the primary provider fails, falls back to the secondary provider.
   *
   * @param {string} taskType - The type of task (e.g. 'code-generation')
   * @param {Object} options - Generation options (systemMessage, prompt, etc.)
   * @returns {Promise<{content: string, usage: Object, model: string, provider: string, fallbackUsed: boolean}>}
   */
  async route(taskType, options) {
    const route = ROUTING_TABLE[taskType];

    if (!route) {
      logger.warn('Unknown task type, defaulting to anthropic', { taskType });
      return this._generateWithProvider('anthropic', {
        ...options,
        model: options.model || 'claude-sonnet-4-6',
      });
    }

    // Try primary provider
    try {
      const result = await this._generateWithProvider(route.primary, {
        ...options,
        model: options.model || route.model,
      });

      return {
        ...result,
        provider: route.primary,
        fallbackUsed: false,
      };
    } catch (primaryError) {
      logger.warn('Primary provider failed, trying fallback', {
        taskType,
        primary: route.primary,
        fallback: route.fallback,
        error: primaryError.message,
      });

      // Try fallback provider
      try {
        const fallbackProvider = this.providers[route.fallback];
        if (!fallbackProvider) {
          throw new Error(`Fallback provider ${route.fallback} not available`);
        }

        // Let the fallback use its own default model
        const fallbackOptions = { ...options };
        delete fallbackOptions.model;

        const result = await fallbackProvider.generate(fallbackOptions);

        return {
          ...result,
          provider: route.fallback,
          fallbackUsed: true,
        };
      } catch (fallbackError) {
        logger.error('Both primary and fallback providers failed', {
          taskType,
          primary: route.primary,
          fallback: route.fallback,
          primaryError: primaryError.message,
          fallbackError: fallbackError.message,
        });

        throw new Error(
          `LLM routing failed for task type "${taskType}": ` +
          `primary (${route.primary}) error: ${primaryError.message}, ` +
          `fallback (${route.fallback}) error: ${fallbackError.message}`
        );
      }
    }
  }

  /**
   * Generate a response using a specific provider.
   * @private
   */
  async _generateWithProvider(providerName, options) {
    const provider = this.providers[providerName];

    if (!provider) {
      throw new Error(`LLM provider "${providerName}" not found`);
    }

    return provider.generate(options);
  }

  /**
   * Get a provider service instance by name.
   * @param {string} name - Provider name: 'anthropic', 'fireworks', 'openai'
   * @returns {Object} The provider service instance
   */
  getProvider(name) {
    const provider = this.providers[name];

    if (!provider) {
      throw new Error(`LLM provider "${name}" not found. Available: ${Object.keys(this.providers).join(', ')}`);
    }

    return provider;
  }
}

// Singleton instance
const llmRouter = new LLMRouter();

module.exports = llmRouter;
