const { db } = require('../config/database');
const logger = require('../config/logger');
const llmRouter = require('./llmRouter');

class PromptTracker {
  /**
   * Track an LLM call by logging it in the prompt_logs table.
   * Wraps a callFn that returns { content, usage, model, provider }.
   *
   * @param {Object} options
   * @param {string} [options.projectId] - Associated project ID
   * @param {string} options.userId - User who triggered the call
   * @param {string} options.taskType - Task type (e.g. 'code-generation')
   * @param {string} [options.correlationId] - Request correlation ID
   * @param {Function} options.callFn - Async function that performs the LLM call
   * @returns {Promise<{...result, promptLogId: string}>}
   */
  async track(options) {
    const { projectId, userId, taskType, correlationId, callFn } = options;

    // Create initial prompt_log entry
    let promptLogId;
    try {
      const [logEntry] = await db('prompt_logs')
        .insert({
          project_id: projectId || null,
          user_id: userId,
          task_type: taskType,
          correlation_id: correlationId || null,
          status: 'pending',
          created_at: db.fn.now(),
        })
        .returning('id');

      promptLogId = logEntry.id || logEntry;
    } catch (dbError) {
      logger.error('Failed to create prompt_log entry', {
        error: dbError.message,
        taskType,
        userId,
      });
      // Continue without tracking -- do not block the LLM call
      promptLogId = null;
    }

    const startTime = Date.now();
    let result;

    try {
      // Execute the LLM call
      result = await callFn();

      const latencyMs = Date.now() - startTime;

      // Estimate cost
      const provider = llmRouter.getProvider(result.provider || 'anthropic');
      const cost = provider.estimateCost(
        result.usage?.inputTokens || 0,
        result.usage?.outputTokens || 0,
        result.model
      );

      // Update prompt_log with success
      if (promptLogId) {
        try {
          await db('prompt_logs')
            .where('id', promptLogId)
            .update({
              status: 'success',
              model: result.model,
              provider: result.provider || null,
              input_tokens: result.usage?.inputTokens || 0,
              output_tokens: result.usage?.outputTokens || 0,
              total_tokens: result.usage?.totalTokens || 0,
              cost_usd: cost.totalCost,
              latency_ms: latencyMs,
              response_preview: (result.content || '').substring(0, 500),
              updated_at: db.fn.now(),
            });
        } catch (updateError) {
          logger.error('Failed to update prompt_log with success', {
            promptLogId,
            error: updateError.message,
          });
        }
      }

      // Update project cost_breakdown if projectId provided
      if (projectId) {
        await this._updateProjectCost(projectId, cost.totalCost, result.provider || 'anthropic');
      }

      logger.info('Prompt tracked successfully', {
        promptLogId,
        taskType,
        model: result.model,
        latencyMs,
        cost: cost.totalCost,
      });

      return { ...result, promptLogId };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      // Update prompt_log with failure
      if (promptLogId) {
        try {
          await db('prompt_logs')
            .where('id', promptLogId)
            .update({
              status: 'error',
              error_message: error.message,
              latency_ms: latencyMs,
              updated_at: db.fn.now(),
            });
        } catch (updateError) {
          logger.error('Failed to update prompt_log with error', {
            promptLogId,
            error: updateError.message,
          });
        }
      }

      logger.error('Prompt tracking caught LLM error', {
        promptLogId,
        taskType,
        error: error.message,
        latencyMs,
      });

      throw error;
    }
  }

  /**
   * Update the project's cost_breakdown JSON column.
   * @private
   */
  async _updateProjectCost(projectId, costUsd, provider) {
    try {
      const project = await db('projects')
        .where('id', projectId)
        .select('cost_breakdown')
        .first();

      if (!project) {
        logger.warn('Project not found for cost update', { projectId });
        return;
      }

      const breakdown = project.cost_breakdown || {};

      // Increment provider-specific cost
      breakdown[provider] = (breakdown[provider] || 0) + costUsd;

      // Increment total
      breakdown.total = (breakdown.total || 0) + costUsd;

      // Increment call count
      breakdown.callCount = (breakdown.callCount || 0) + 1;

      await db('projects')
        .where('id', projectId)
        .update({
          cost_breakdown: JSON.stringify(breakdown),
          updated_at: db.fn.now(),
        });

      logger.debug('Project cost updated', { projectId, provider, costUsd, total: breakdown.total });
    } catch (error) {
      logger.error('Failed to update project cost', {
        projectId,
        error: error.message,
      });
    }
  }
}

// Singleton instance
const promptTracker = new PromptTracker();

module.exports = promptTracker;
