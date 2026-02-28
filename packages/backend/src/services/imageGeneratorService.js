const axios = require('axios');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { retryWithBackoff } = require('../utils/retryLogic');
const config = require('../config/environment');
const logger = require('../config/logger');
const promptTracker = require('./promptTracker');

const DEFAULT_MODEL = 'accounts/fireworks/models/flux-1-dev-fp8';
const REQUEST_TIMEOUT = 120000; // 2 minutes — image gen can be slow

// Pricing per step
const STEP_PRICING = {
  'accounts/fireworks/models/flux-1-dev-fp8': 0.0005,
  'accounts/fireworks/models/flux-1-schnell-fp8': 0.00035,
  'accounts/fireworks/models/stable-diffusion-xl-1024-v1-0': 0.00013,
};

// Default steps per model
const DEFAULT_STEPS = {
  'accounts/fireworks/models/flux-1-dev-fp8': 28,
  'accounts/fireworks/models/flux-1-schnell-fp8': 4,
  'accounts/fireworks/models/stable-diffusion-xl-1024-v1-0': 30,
};

class ImageGeneratorService {
  constructor() {
    this.breaker = createCircuitBreaker(
      (params) => this._callApi(params),
      'fireworks-image',
      { timeout: REQUEST_TIMEOUT + 10000 }
    );

    logger.info('ImageGeneratorService initialized');
  }

  /**
   * Generate an image using Fireworks FLUX models.
   *
   * @param {Object} options
   * @param {string} options.prompt - Image description
   * @param {number} [options.width=1024] - Image width
   * @param {number} [options.height=1024] - Image height
   * @param {number} [options.steps] - Number of inference steps
   * @param {string} [options.model] - Model to use
   * @param {string} [options.projectId] - For cost tracking
   * @param {string} [options.userId] - For cost tracking
   * @param {string} [options.correlationId] - For log correlation
   * @returns {Promise<{base64: string, model: string, cost: number, width: number, height: number}>}
   */
  async generateImage(options) {
    const {
      prompt,
      width = 1024,
      height = 1024,
      model = DEFAULT_MODEL,
      projectId,
      userId,
      correlationId,
    } = options;

    const steps = options.steps || DEFAULT_STEPS[model] || 28;

    logger.info('Generating image', { model, width, height, steps, promptPreview: prompt.substring(0, 100) });

    const result = await promptTracker.track({
      projectId,
      userId,
      taskType: 'image-generation',
      correlationId,
      prompt,
      systemMessage: `Image generation: ${model}`,
      callFn: async () => {
        const response = await retryWithBackoff(
          () => this.breaker.fire({ prompt, width, height, steps, model }),
          { maxRetries: 1, baseDelay: 2000, name: 'fireworks-image' }
        );

        const cost = this.estimateCost(steps, model);

        return {
          content: response.base64,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          model,
          provider: 'fireworks',
          imageCost: cost,
        };
      },
    });

    const cost = this.estimateCost(steps, model);

    return {
      base64: result.content,
      model,
      cost,
      width,
      height,
    };
  }

  /**
   * Estimate the cost of image generation.
   * @param {number} steps - Number of inference steps
   * @param {string} model - Model ID
   * @returns {number} Cost in USD
   */
  estimateCost(steps, model = DEFAULT_MODEL) {
    const pricePerStep = STEP_PRICING[model] || 0.0005;
    return parseFloat((steps * pricePerStep).toFixed(6));
  }

  /**
   * Make the raw API call to Fireworks image generation.
   * @private
   */
  async _callApi({ prompt, width, height, steps, model }) {
    const url = `https://api.fireworks.ai/inference/v1/image_generation/${model}`;

    const payload = {
      prompt,
      width,
      height,
      steps,
      response_format: 'b64_json',
    };

    const response = await axios.post(url, payload, {
      headers: {
        'Authorization': `Bearer ${config.fireworksApiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: REQUEST_TIMEOUT,
    });

    // Fireworks returns { data: [{ b64_json: "..." }] }
    const imageData = response.data?.data?.[0];
    if (!imageData || !imageData.b64_json) {
      throw new Error('No image data in Fireworks response');
    }

    return { base64: imageData.b64_json };
  }
}

const imageGeneratorService = new ImageGeneratorService();
module.exports = imageGeneratorService;
