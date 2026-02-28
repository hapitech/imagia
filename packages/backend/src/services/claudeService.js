const Anthropic = require('@anthropic-ai/sdk');
const cacheService = require('./cacheService');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { retryWithBackoff } = require('../utils/retryLogic');
const { llmCacheKey } = require('../utils/contentHash');
const config = require('../config/environment');
const logger = require('../config/logger');

const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Pricing per million tokens
const PRICING = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
};

class ClaudeService {
  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropicApiKey,
    });

    this.breaker = createCircuitBreaker(
      (params) => this._callApi(params),
      'anthropic-claude',
      { timeout: 60000 }
    );

    logger.info('ClaudeService initialized');
  }

  /**
   * Generate a completion from Claude.
   * @param {Object} options
   * @param {string} options.systemMessage - System prompt
   * @param {string} options.prompt - User prompt
   * @param {string} [options.model] - Model to use
   * @param {number} [options.maxTokens] - Max tokens in response
   * @param {number} [options.temperature] - Sampling temperature
   * @param {string} [options.responseFormat] - 'text' or 'json'
   * @returns {Promise<{content: string, usage: Object, model: string}>}
   */
  async generate(options) {
    const {
      systemMessage,
      prompt,
      model = DEFAULT_MODEL,
      maxTokens = 4096,
      temperature = 0.7,
      responseFormat = 'text',
    } = options;

    // Check cache first
    const cacheKey = llmCacheKey(
      `${systemMessage || ''}:${prompt}:${model}:${maxTokens}:${temperature}:${responseFormat}`,
      model
    );

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      logger.debug('Claude cache hit', { model, cacheKey });
      return cached;
    }

    // Call API via circuit breaker with retry
    const params = { systemMessage, prompt, model, maxTokens, temperature };

    const response = await retryWithBackoff(
      () => this.breaker.fire(params),
      { maxRetries: 2, baseDelay: 1000, name: 'claude-generate' }
    );

    // Extract content
    let content = response.content[0]?.text || '';

    // Extract token usage
    const usage = {
      inputTokens: response.usage?.input_tokens || 0,
      outputTokens: response.usage?.output_tokens || 0,
      totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    };

    // If JSON format requested, extract JSON from response
    if (responseFormat === 'json') {
      content = this._extractJson(content);
    }

    const result = { content, usage, model };

    // Cache the result
    await cacheService.set(cacheKey, result, config.cacheTtlLlm);

    logger.info('Claude generation complete', {
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    return result;
  }

  /**
   * Estimate the cost of a generation.
   */
  estimateCost(inputTokens, outputTokens, model = DEFAULT_MODEL) {
    const pricing = PRICING[model] || PRICING[DEFAULT_MODEL];

    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return {
      inputCost: parseFloat(inputCost.toFixed(6)),
      outputCost: parseFloat(outputCost.toFixed(6)),
      totalCost: parseFloat((inputCost + outputCost).toFixed(6)),
    };
  }

  /**
   * Make the raw API call to Anthropic.
   * @private
   */
  async _callApi({ systemMessage, prompt, model, maxTokens, temperature }) {
    const messages = [{ role: 'user', content: prompt }];

    const params = {
      model,
      max_tokens: maxTokens,
      temperature,
      messages,
    };

    if (systemMessage) {
      params.system = systemMessage;
    }

    return this.client.messages.create(params);
  }

  /**
   * Extract JSON from a response that may be wrapped in markdown fences.
   * @private
   */
  _extractJson(text) {
    let cleaned = text.trim();

    // Remove markdown code fences
    const fenceMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    // Sanitize control characters
    cleaned = this._sanitizeJsonText(cleaned);

    // Validate it parses as JSON
    try {
      JSON.parse(cleaned);
      return cleaned;
    } catch (error) {
      logger.warn('Failed to parse Claude response as JSON, returning raw content', {
        error: error.message,
      });
      return cleaned;
    }
  }

  /**
   * Remove control characters that break JSON parsing.
   * @private
   */
  _sanitizeJsonText(text) {
    // Remove control characters except newline, carriage return, tab
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
}

// Singleton instance
const claudeService = new ClaudeService();

module.exports = claudeService;
