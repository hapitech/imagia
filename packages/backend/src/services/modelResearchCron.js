/**
 * Model Research Cron
 *
 * Runs once daily to check for new/updated models on Fireworks AI.
 * Updates the llm_models catalog table and logs findings.
 */

const axios = require('axios');
const { db } = require('../config/database');
const config = require('../config/environment');
const logger = require('../config/logger');
const modelRegistry = require('./modelRegistry');

const FIREWORKS_MODELS_API = 'https://api.fireworks.ai/inference/v1/models';
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

/**
 * Known model capabilities based on model name patterns.
 * Used to auto-classify discovered models.
 */
const CAPABILITY_PATTERNS = [
  { regex: /coder|code|codestral/i, capabilities: ['code', 'reasoning'] },
  { regex: /flux|stable-diffusion|sdxl|playground|imagen/i, capabilities: ['image'] },
  { regex: /deepseek-r1|o1|reasoning/i, capabilities: ['reasoning'] },
  { regex: /llama|mixtral|mistral|qwen|gemma|phi/i, capabilities: ['code', 'text', 'reasoning'] },
  { regex: /gpt|claude|deepseek-v/i, capabilities: ['code', 'text', 'reasoning'] },
];

/**
 * Run the model research job.
 * Fetches latest models from Fireworks, compares with catalog, logs findings.
 */
async function runResearch() {
  logger.info('Model research cron starting');

  const findings = {
    modelsChecked: 0,
    newModelsFound: [],
    pricingChanges: [],
    deprecatedModels: [],
    recommendations: '',
  };

  let rawResponse = null;

  try {
    // 1. Fetch models from Fireworks API
    const response = await axios.get(FIREWORKS_MODELS_API, {
      headers: {
        'Authorization': `Bearer ${config.fireworksApiKey}`,
        'Accept': 'application/json',
      },
      timeout: 30000,
    });

    const apiModels = response.data?.data || response.data?.models || [];
    rawResponse = apiModels.slice(0, 100); // Store first 100 for audit
    findings.modelsChecked = apiModels.length;

    logger.info('Fetched models from Fireworks API', { count: apiModels.length });

    // 2. Get current catalog
    const currentModels = await db('llm_models')
      .where({ provider: 'fireworks' })
      .select('model_id', 'pricing_input', 'pricing_output', 'display_name');

    const currentModelIds = new Set(currentModels.map((m) => m.model_id));

    // 3. Check for new models
    const newModels = [];
    for (const apiModel of apiModels) {
      const modelId = apiModel.id || apiModel.model;
      if (!modelId) continue;

      // Only track instruct/chat models (skip base models)
      const fullId = modelId.startsWith('accounts/')
        ? modelId
        : `accounts/fireworks/models/${modelId}`;

      if (!currentModelIds.has(fullId)) {
        const capabilities = inferCapabilities(fullId);
        newModels.push({
          provider: 'fireworks',
          model_id: fullId,
          display_name: apiModel.name || modelId.split('/').pop(),
          capabilities,
          context_window: apiModel.context_length || 0,
          quality_score: 50,
        });
        findings.newModelsFound.push(fullId);
      }
    }

    // 4. Insert new models as inactive
    if (newModels.length > 0) {
      await modelRegistry.updateModelCatalog(newModels);
      logger.info('New models added to catalog', { count: newModels.length });
    }

    // 5. Update last_verified_at for existing models found in API
    const apiModelIds = new Set(
      apiModels.map((m) => {
        const id = m.id || m.model;
        return id?.startsWith('accounts/') ? id : `accounts/fireworks/models/${id}`;
      })
    );

    for (const current of currentModels) {
      if (apiModelIds.has(current.model_id)) {
        await db('llm_models')
          .where({ provider: 'fireworks', model_id: current.model_id })
          .update({ last_verified_at: db.fn.now(), updated_at: db.fn.now() });
      }
    }

    // 6. Build recommendations summary
    const recs = [];
    if (newModels.length > 0) {
      const codeModels = newModels.filter((m) => m.capabilities.includes('code'));
      if (codeModels.length > 0) {
        recs.push(`New code models found: ${codeModels.map((m) => m.display_name).join(', ')}`);
      }
      const imageModels = newModels.filter((m) => m.capabilities.includes('image'));
      if (imageModels.length > 0) {
        recs.push(`New image models found: ${imageModels.map((m) => m.display_name).join(', ')}`);
      }
    }
    if (recs.length === 0) {
      recs.push('No significant changes detected. Current model catalog is up to date.');
    }
    findings.recommendations = recs.join('\n');

  } catch (err) {
    logger.error('Model research cron failed to fetch from Fireworks', {
      error: err.message,
    });
    findings.recommendations = `Research failed: ${err.message}`;
  }

  // 7. Log the findings
  try {
    await db('model_research_logs').insert({
      run_at: db.fn.now(),
      models_checked: findings.modelsChecked,
      new_models_found: JSON.stringify(findings.newModelsFound),
      pricing_changes: JSON.stringify(findings.pricingChanges),
      deprecated_models: JSON.stringify(findings.deprecatedModels),
      recommendations: findings.recommendations,
      raw_response: rawResponse ? JSON.stringify(rawResponse) : null,
    });

    logger.info('Model research cron completed', {
      modelsChecked: findings.modelsChecked,
      newModels: findings.newModelsFound.length,
    });
  } catch (dbErr) {
    logger.error('Failed to log model research results', { error: dbErr.message });
  }

  return findings;
}

/**
 * Infer capabilities from a model ID based on naming patterns.
 */
function inferCapabilities(modelId) {
  for (const { regex, capabilities } of CAPABILITY_PATTERNS) {
    if (regex.test(modelId)) return capabilities;
  }
  return ['text'];
}

/**
 * Start the daily research schedule.
 * Returns a cleanup function to clear the interval.
 */
function startScheduled() {
  // Run once at startup (after a 30s delay to let DB connect)
  setTimeout(() => {
    runResearch().catch((err) => {
      logger.error('Initial model research failed', { error: err.message });
    });
  }, 30000);

  // Then run every 24 hours
  const interval = setInterval(() => {
    runResearch().catch((err) => {
      logger.error('Scheduled model research failed', { error: err.message });
    });
  }, TWENTY_FOUR_HOURS);

  logger.info('Model research cron scheduled (daily)');

  return () => clearInterval(interval);
}

module.exports = {
  runResearch,
  startScheduled,
};
