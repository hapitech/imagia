const axios = require('axios');
const cacheService = require('./cacheService');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { retryWithBackoff } = require('../utils/retryLogic');
const { llmCacheKey } = require('../utils/contentHash');
const config = require('../config/environment');
const logger = require('../config/logger');

const API_ENDPOINT = 'https://api.fireworks.ai/inference/v1/chat/completions';
const DEFAULT_MODEL = 'accounts/fireworks/models/kimi-k2p5';
const REQUEST_TIMEOUT = 60000; // 60 seconds
const TOOLS_TIMEOUT = 120000; // 120 seconds for tool-calling sessions

// Pricing per million tokens
const PRICING = {
  'accounts/fireworks/models/kimi-k2p5': { input: 0.60, output: 3.00 },
  'accounts/fireworks/models/kimi-k2-instruct-0905': { input: 0.60, output: 2.50 },
  'accounts/fireworks/models/kimi-k2-thinking': { input: 0.60, output: 2.50 },
  'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct': { input: 0.45, output: 1.80 },
  'accounts/fireworks/models/qwen3-8b': { input: 0.20, output: 0.20 },
  'accounts/fireworks/models/llama-v3p3-70b-instruct': { input: 0.90, output: 0.90 },
  'accounts/fireworks/models/mixtral-8x7b-instruct': { input: 0.50, output: 0.50 },
  'accounts/fireworks/models/qwen2p5-coder-32b-instruct': { input: 0.90, output: 0.90 },
};

class FireworksService {
  constructor() {
    this.breaker = createCircuitBreaker(
      (params) => this._callApi(params),
      'fireworks-ai',
      { timeout: 90000, errorThreshold: 75, resetTimeout: 30000, volumeThreshold: 5 }
    );

    // Separate circuit breaker for tool-calling sessions to prevent cascade
    this.toolsBreaker = createCircuitBreaker(
      (params) => this._callApiWithTools(params),
      'fireworks-ai-tools',
      { timeout: 150000, errorThreshold: 75, resetTimeout: 30000, volumeThreshold: 3 }
    );

    if (!config.fireworksApiKey) {
      logger.warn('FIREWORKS_API_KEY not set — Fireworks AI calls will fail');
    }
    logger.info('FireworksService initialized');
  }

  /**
   * Generate a completion from Fireworks AI.
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
    if (!config.fireworksApiKey) {
      throw new Error('Fireworks API key not configured. Set FIREWORKS_API_KEY environment variable.');
    }

    // Check cache first
    const cacheKey = llmCacheKey(
      `${systemMessage || ''}:${prompt}:${model}:${maxTokens}:${temperature}:${responseFormat}`,
      model
    );

    const cached = await cacheService.get(cacheKey);
    if (cached) {
      logger.debug('Fireworks cache hit', { model, cacheKey });
      return cached;
    }

    // Call API via circuit breaker with retry
    const params = { systemMessage, prompt, model, maxTokens, temperature };

    const response = await retryWithBackoff(
      () => this.breaker.fire(params),
      { maxRetries: 2, baseDelay: 1000, name: 'fireworks-generate' }
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

    logger.info('Fireworks generation complete', {
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
   * Make the raw API call to Fireworks AI with a timeout.
   * @private
   */
  async _callApi({ systemMessage, prompt, model, maxTokens, temperature }) {
    const messages = [];

    if (systemMessage) {
      messages.push({ role: 'system', content: systemMessage });
    }

    messages.push({ role: 'user', content: prompt });

    // Fireworks requires stream=true for max_tokens > 4096; cap for non-streaming
    const payload = {
      model,
      messages,
      max_tokens: Math.min(maxTokens, 4096),
      temperature,
    };

    // Race between the API call and a timeout
    const apiCall = axios.post(API_ENDPOINT, payload, {
      headers: {
        'Authorization': `Bearer ${config.fireworksApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: REQUEST_TIMEOUT,
    });

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Fireworks API request timed out')), REQUEST_TIMEOUT);
    });

    const response = await Promise.race([apiCall, timeout]);

    return response.data;
  }

  /**
   * Generate a completion with tool-calling support.
   * Uses a separate circuit breaker to prevent cascade from non-tool calls.
   *
   * @param {Object} options
   * @param {Array} options.messages - Full conversation messages array
   * @param {Array} options.tools - Tool definitions in OpenAI format
   * @param {string} [options.toolChoice] - 'auto', 'none', or specific tool
   * @param {string} [options.model] - Model to use
   * @param {number} [options.maxTokens] - Max tokens
   * @param {number} [options.temperature] - Sampling temperature
   * @returns {Promise<{message: {role: string, content: string, toolCalls: Array}, usage: Object, model: string, finishReason: string}>}
   */
  async generateWithTools(options) {
    const {
      messages,
      tools,
      toolChoice = 'auto',
      model = DEFAULT_MODEL,
      maxTokens = 8192,
      temperature = 0.3,
    } = options;

    if (!config.fireworksApiKey) {
      throw new Error('Fireworks API key not configured. Set FIREWORKS_API_KEY environment variable.');
    }

    const params = { messages, tools, toolChoice, model, maxTokens, temperature };

    const response = await this.toolsBreaker.fire(params);

    const choice = response.choices?.[0] || {};
    const msg = choice.message || {};

    // Normalize tool_calls to toolCalls
    const toolCalls = (msg.tool_calls || []).map((tc) => ({
      id: tc.id,
      name: tc.function?.name,
      arguments: typeof tc.function?.arguments === 'string'
        ? JSON.parse(tc.function.arguments)
        : tc.function?.arguments || {},
    }));

    const usage = {
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    };

    // Map finish_reason: 'tool_calls' stays, 'stop' stays
    const finishReason = choice.finish_reason === 'tool_calls' ? 'tool_calls' : choice.finish_reason || 'stop';

    logger.info('Fireworks tool-calling generation complete', {
      model,
      toolCalls: toolCalls.length,
      finishReason,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    });

    return {
      message: {
        role: msg.role || 'assistant',
        content: msg.content || '',
        toolCalls,
      },
      usage,
      model,
      finishReason,
    };
  }

  /**
   * Make API call with tools support and longer timeout.
   * @private
   */
  async _callApiWithTools({ messages, tools, toolChoice, model, maxTokens, temperature }) {
    // Fireworks requires stream=true for max_tokens > 4096.
    // For non-streaming, cap at 4096.
    const effectiveMaxTokens = Math.min(maxTokens, 4096);

    const payload = {
      model,
      messages,
      max_tokens: effectiveMaxTokens,
      temperature,
      tools,
      tool_choice: toolChoice,
    };

    const apiCall = axios.post(API_ENDPOINT, payload, {
      headers: {
        'Authorization': `Bearer ${config.fireworksApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: TOOLS_TIMEOUT,
    });

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Fireworks tools API request timed out')), TOOLS_TIMEOUT);
    });

    const response = await Promise.race([apiCall, timeout]);

    return response.data;
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
      logger.warn('Failed to parse Fireworks response as JSON, returning raw content', {
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
const fireworksService = new FireworksService();

module.exports = fireworksService;
