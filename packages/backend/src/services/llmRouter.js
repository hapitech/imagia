const claudeService = require('./claudeService');
const fireworksService = require('./fireworksService');
const openaiService = require('./openaiService');
const config = require('../config/environment');
const logger = require('../config/logger');

/**
 * Routing table mapping task types to primary and fallback LLM providers.
 *
 * Default code model: Qwen3 Coder 480B via Fireworks ($0.45/$1.80 per 1M tokens)
 * This replaces Anthropic as primary to avoid failures when ANTHROPIC_API_KEY is missing.
 */
const ROUTING_TABLE = {
  'code-generation': {
    primary: 'fireworks',
    model: 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
    fallback: 'openai',
  },
  'code-iteration': {
    primary: 'fireworks',
    model: 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
    fallback: 'openai',
  },
  'scaffold': {
    primary: 'fireworks',
    model: 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
    fallback: 'openai',
  },
  'config-files': {
    primary: 'fireworks',
    model: 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
    fallback: 'openai',
  },
  'landing-page': {
    primary: 'openai',
    model: 'gpt-4o',
    fallback: 'fireworks',
  },
  'social-copy': {
    primary: 'openai',
    model: 'gpt-4o',
    fallback: 'fireworks',
  },
  'ad-copy': {
    primary: 'openai',
    model: 'gpt-4o',
    fallback: 'fireworks',
  },
  'email-template': {
    primary: 'openai',
    model: 'gpt-4o',
    fallback: 'fireworks',
  },
  'demo-script': {
    primary: 'fireworks',
    model: 'accounts/fireworks/models/deepseek-v3',
    fallback: 'openai',
  },
};

/**
 * Maps model IDs to their provider name for model override routing.
 */
const MODEL_TO_PROVIDER = {
  'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct': 'fireworks',
  'accounts/fireworks/models/deepseek-v3': 'fireworks',
  'accounts/fireworks/models/llama-v3p3-70b-instruct': 'fireworks',
  'accounts/fireworks/models/mixtral-8x7b-instruct': 'fireworks',
  'accounts/fireworks/models/qwen2p5-coder-32b-instruct': 'fireworks',
  'gpt-4o': 'openai',
  'claude-sonnet-4-6': 'anthropic',
  'claude-sonnet-4-20250514': 'anthropic',
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
      hasAnthropicKey: !!config.anthropicApiKey,
    });
  }

  /**
   * Route a request to the appropriate LLM provider based on task type.
   * If the primary provider fails, falls back to the secondary provider.
   *
   * @param {string} taskType - The type of task (e.g. 'code-generation')
   * @param {Object} options - Generation options (systemMessage, prompt, etc.)
   * @param {string} [options.modelOverride] - Explicit model ID from user selection (bypasses routing table)
   * @returns {Promise<{content: string, usage: Object, model: string, provider: string, fallbackUsed: boolean}>}
   */
  async route(taskType, options) {
    const { modelOverride, ...genOptions } = options;

    // If user selected a specific model, use it directly
    if (modelOverride && modelOverride !== 'auto') {
      return this._routeWithModelOverride(modelOverride, genOptions);
    }

    const route = ROUTING_TABLE[taskType];

    if (!route) {
      logger.warn('Unknown task type, defaulting to fireworks', { taskType });
      return this._generateWithProvider('fireworks', {
        ...genOptions,
        model: genOptions.model || 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct',
      });
    }

    // Try primary provider
    try {
      const result = await this._generateWithProvider(route.primary, {
        ...genOptions,
        model: genOptions.model || route.model,
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
        const fallbackOptions = { ...genOptions };
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
   * Route directly to a specific model selected by the user.
   * @private
   */
  async _routeWithModelOverride(modelId, options) {
    const providerName = MODEL_TO_PROVIDER[modelId];

    if (!providerName) {
      // Try to infer provider from model ID
      if (modelId.startsWith('accounts/fireworks/')) {
        return this._generateWithProvider('fireworks', { ...options, model: modelId });
      }
      if (modelId.startsWith('claude-')) {
        return this._generateWithProvider('anthropic', { ...options, model: modelId });
      }
      if (modelId.startsWith('gpt-')) {
        return this._generateWithProvider('openai', { ...options, model: modelId });
      }

      logger.warn('Unknown model override, using fireworks default', { modelId });
      return this._generateWithProvider('fireworks', options);
    }

    const result = await this._generateWithProvider(providerName, {
      ...options,
      model: modelId,
    });

    return {
      ...result,
      provider: providerName,
      fallbackUsed: false,
    };
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
