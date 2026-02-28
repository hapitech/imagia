const { db } = require('../config/database');
const logger = require('../config/logger');

// In-memory cache for active models (refreshed every hour)
let cachedModels = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

class ModelRegistry {
  /**
   * Get all active models, cached for 1 hour.
   * @returns {Promise<Array>}
   */
  async getActiveModels() {
    if (cachedModels && Date.now() < cacheExpiry) {
      return cachedModels;
    }

    try {
      const models = await db('llm_models')
        .where({ is_active: true })
        .orderBy('quality_score', 'desc');

      // Parse capabilities JSON
      cachedModels = models.map((m) => ({
        ...m,
        capabilities: typeof m.capabilities === 'string'
          ? JSON.parse(m.capabilities)
          : m.capabilities || [],
      }));
      cacheExpiry = Date.now() + CACHE_TTL_MS;

      return cachedModels;
    } catch (err) {
      logger.error('Failed to fetch active models', { error: err.message });
      // Return cached if available, even if expired
      return cachedModels || [];
    }
  }

  /**
   * Get models filtered by capability.
   * @param {string} capability - 'code', 'text', 'image', 'reasoning'
   * @returns {Promise<Array>}
   */
  async getModelsForCapability(capability) {
    const models = await this.getActiveModels();
    return models.filter((m) => m.capabilities.includes(capability));
  }

  /**
   * Get the default model for a capability.
   * @param {string} capability - 'code', 'text', 'image'
   * @returns {Promise<Object|null>}
   */
  async getDefaultModel(capability) {
    const models = await this.getActiveModels();
    return models.find((m) => m.is_default && m.default_for === capability) || null;
  }

  /**
   * Look up a model by its API model_id.
   * @param {string} modelId - e.g. 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct'
   * @returns {Promise<Object|null>}
   */
  async getModelById(modelId) {
    const models = await this.getActiveModels();
    return models.find((m) => m.model_id === modelId) || null;
  }

  /**
   * Get models grouped by capability for the frontend dropdown.
   * @returns {Promise<Object>}
   */
  async getModelsGrouped() {
    const models = await this.getActiveModels();
    const grouped = { code: [], text: [], image: [], reasoning: [] };

    for (const model of models) {
      for (const cap of model.capabilities) {
        if (grouped[cap]) {
          grouped[cap].push({
            id: model.model_id,
            provider: model.provider,
            displayName: model.display_name,
            qualityScore: model.quality_score,
            pricingInput: parseFloat(model.pricing_input),
            pricingOutput: parseFloat(model.pricing_output),
            pricingPerImage: model.pricing_per_image ? parseFloat(model.pricing_per_image) : null,
            contextWindow: model.context_window,
            isDefault: model.is_default && model.default_for === cap,
          });
        }
      }
    }

    return grouped;
  }

  /**
   * Bulk upsert models from the research cron.
   * @param {Array} models - Array of model objects to upsert
   * @returns {Promise<{inserted: number, updated: number}>}
   */
  async updateModelCatalog(models) {
    let inserted = 0;
    let updated = 0;

    for (const model of models) {
      const existing = await db('llm_models')
        .where({ provider: model.provider, model_id: model.model_id })
        .first();

      if (existing) {
        await db('llm_models')
          .where({ id: existing.id })
          .update({
            pricing_input: model.pricing_input ?? existing.pricing_input,
            pricing_output: model.pricing_output ?? existing.pricing_output,
            context_window: model.context_window ?? existing.context_window,
            last_verified_at: db.fn.now(),
            updated_at: db.fn.now(),
          });
        updated++;
      } else {
        await db('llm_models').insert({
          provider: model.provider,
          model_id: model.model_id,
          display_name: model.display_name || model.model_id.split('/').pop(),
          capabilities: JSON.stringify(model.capabilities || ['text']),
          pricing_input: model.pricing_input || 0,
          pricing_output: model.pricing_output || 0,
          context_window: model.context_window || 0,
          quality_score: model.quality_score || 50,
          is_active: false, // New models require manual activation
          is_default: false,
          notes: 'Auto-discovered by model research cron',
          last_verified_at: db.fn.now(),
        });
        inserted++;
      }
    }

    // Invalidate cache
    cachedModels = null;
    cacheExpiry = 0;

    logger.info('Model catalog updated', { inserted, updated });
    return { inserted, updated };
  }

  /**
   * Invalidate the in-memory cache.
   */
  invalidateCache() {
    cachedModels = null;
    cacheExpiry = 0;
  }
}

const modelRegistry = new ModelRegistry();
module.exports = modelRegistry;
