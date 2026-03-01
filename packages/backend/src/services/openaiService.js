const OpenAI = require('openai');
const cacheService = require('./cacheService');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { retryWithBackoff } = require('../utils/retryLogic');
const { llmCacheKey } = require('../utils/contentHash');
const config = require('../config/environment');
const logger = require('../config/logger');

const DEFAULT_MODEL = 'gpt-4o';

// Pricing per million tokens
const PRICING = {
  'gpt-4o': { input: 2.50, output: 10.0 },
};

class OpenAIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: config.openaiApiKey,
    });

    this.breaker = createCircuitBreaker(
      (params) => this._callApi(params),
      'openai-gpt',
      { timeout: 60000, errorThreshold: 75, resetTimeout: 30000, volumeThreshold: 5 }
    );

    if (!config.openaiApiKey) {
      logger.warn('OPENAI_API_KEY not set — OpenAI calls will fail');
    }
    logger.info('OpenAIService initialized');
  }

  /**
   * Generate a completion from OpenAI.
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

    // Fail fast if no API key (don't trip circuit breaker)
    if (!config.openaiApiKey) {
      throw new Error('OpenAI API key not configured. Set OPENAI_API_KEY environment variable.');
    }

    // Check cache first
    const cacheKey = llmCacheKey(
      `${systemMessage || ''}:${prompt}:${model}:${maxTokens}:${temperature}:${responseFormat}`,
      model
    );

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      logger.debug('OpenAI cache hit', { model, cacheKey });
      return cached;
    }

    // Call API via circuit breaker with retry
    const params = { systemMessage, prompt, model, maxTokens, temperature, responseFormat };

    const response = await retryWithBackoff(
      () => this.breaker.fire(params),
      { maxRetries: 2, baseDelay: 1000, name: 'openai-generate' }
    );

    // Extract content
    let content = response.choices?.[0]?.message?.content || '';

    // Extract token usage
    const usage = {
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    };

    // If JSON format requested, extract JSON from response
    if (responseFormat === 'json') {
      content = this._extractJson(content);
    }

    const result = { content, usage, model };

    // Cache the result
    await cacheService.set(cacheKey, result, config.cacheTtlLlm);

    logger.info('OpenAI generation complete', {
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
   * Make the raw API call to OpenAI.
   * @private
   */
  async _callApi({ systemMessage, prompt, model, maxTokens, temperature, responseFormat }) {
    const messages = [];

    if (systemMessage) {
      messages.push({ role: 'system', content: systemMessage });
    }

    messages.push({ role: 'user', content: prompt });

    const params = {
      model,
      messages,
      max_tokens: maxTokens,
      temperature,
    };

    // OpenAI native JSON mode
    if (responseFormat === 'json') {
      params.response_format = { type: 'json_object' };
    }

    return this.client.chat.completions.create(params);
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
      logger.warn('Failed to parse OpenAI response as JSON, returning raw content', {
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
    // eslint-disable-next-line no-control-regex
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }
}

// Singleton instance
const openaiService = new OpenAIService();

module.exports = openaiService;
