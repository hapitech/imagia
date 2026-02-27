/**
 * Cost Tracker Service
 *
 * Centralized tracking for all infrastructure costs:
 * - Railway deployments (compute, bandwidth)
 * - Cloud storage (S3 / local storage estimates)
 * - Database usage
 * - LLM costs (integrates with promptTracker)
 *
 * Costs are tracked per-project in the projects.cost_breakdown JSONB field
 * and individually in the deployments table.
 */

const { db } = require('../config/database');
const logger = require('../config/logger');

// Estimated costs per resource type (USD)
// These are approximations based on Railway/AWS pricing.
// In production, you'd poll actual billing APIs.
const COST_ESTIMATES = {
  // Railway
  railway_deploy: 0.01,              // Per deployment trigger
  railway_compute_per_hour: 0.0005,  // ~$0.36/month for a small service
  railway_bandwidth_per_gb: 0.10,    // Outbound bandwidth
  railway_build_per_minute: 0.005,   // Build time

  // Storage
  storage_per_gb_month: 0.023,       // S3 standard
  storage_per_upload_mb: 0.000005,   // PUT request + transfer

  // Database (Railway PostgreSQL)
  db_per_gb_month: 0.25,            // Storage
  db_compute_per_hour: 0.001,       // Shared compute
};

class CostTracker {
  /**
   * Record a deployment cost event.
   */
  async trackDeploymentCost(projectId, deploymentId, details = {}) {
    const {
      buildMinutes = 2,
      type = 'deploy',
    } = details;

    const cost = COST_ESTIMATES.railway_deploy +
      (buildMinutes * COST_ESTIMATES.railway_build_per_minute);

    // Update deployment record
    if (deploymentId) {
      await db('deployments')
        .where({ id: deploymentId })
        .update({
          cost: db.raw('COALESCE(cost, 0) + ?', [cost]),
          updated_at: db.fn.now(),
        });
    }

    // Update project cost breakdown
    await this._updateProjectCost(projectId, 'deployment', cost);

    logger.info('Deployment cost tracked', {
      projectId,
      deploymentId,
      cost,
      details,
    });

    return cost;
  }

  /**
   * Track ongoing Railway compute costs.
   * Called periodically (e.g., every hour) for active deployments.
   */
  async trackComputeCost(projectId, deploymentId, hours = 1) {
    const cost = hours * COST_ESTIMATES.railway_compute_per_hour;

    if (deploymentId) {
      await db('deployments')
        .where({ id: deploymentId })
        .update({
          cost: db.raw('COALESCE(cost, 0) + ?', [cost]),
          updated_at: db.fn.now(),
        });
    }

    await this._updateProjectCost(projectId, 'deployment', cost);

    return cost;
  }

  /**
   * Track storage cost for a file upload/asset.
   */
  async trackStorageCost(projectId, fileSizeBytes) {
    const fileSizeMB = fileSizeBytes / (1024 * 1024);
    const cost = fileSizeMB * COST_ESTIMATES.storage_per_upload_mb;

    await this._updateProjectCost(projectId, 'storage', cost);

    logger.debug('Storage cost tracked', {
      projectId,
      fileSizeMB: fileSizeMB.toFixed(2),
      cost,
    });

    return cost;
  }

  /**
   * Track LLM cost (called from promptTracker, forwarded here for project-level tracking).
   */
  async trackLLMCost(projectId, cost) {
    await this._updateProjectCost(projectId, 'llm', cost);
    return cost;
  }

  /**
   * Get the full cost breakdown for a project.
   */
  async getProjectCosts(projectId) {
    const project = await db('projects')
      .where({ id: projectId })
      .select('cost_breakdown', 'estimated_cost')
      .first();

    if (!project) return null;

    const breakdown = typeof project.cost_breakdown === 'string'
      ? JSON.parse(project.cost_breakdown)
      : project.cost_breakdown || {};

    // Get deployment costs
    const deployments = await db('deployments')
      .where({ project_id: projectId })
      .select(db.raw('SUM(COALESCE(cost, 0)) as total_deployment_cost'))
      .first();

    // Get LLM costs from prompt_logs
    const llmCosts = await db('prompt_logs')
      .where({ project_id: projectId })
      .select(db.raw('SUM(COALESCE(total_cost, 0)) as total_llm_cost'))
      .first();

    // Get marketing asset generation costs
    const marketingCosts = await db('marketing_assets')
      .where({ project_id: projectId })
      .select(db.raw('SUM(COALESCE(generation_cost, 0)) as total_marketing_cost'))
      .first();

    return {
      breakdown: {
        llm: parseFloat(breakdown.llm || 0),
        deployment: parseFloat(breakdown.deployment || 0),
        storage: parseFloat(breakdown.storage || 0),
      },
      totals: {
        llm: parseFloat(llmCosts?.total_llm_cost || 0),
        deployment: parseFloat(deployments?.total_deployment_cost || 0),
        marketing: parseFloat(marketingCosts?.total_marketing_cost || 0),
      },
      total_estimated: parseFloat(project.estimated_cost || 0),
      total_actual: parseFloat(llmCosts?.total_llm_cost || 0) +
        parseFloat(deployments?.total_deployment_cost || 0) +
        parseFloat(marketingCosts?.total_marketing_cost || 0),
    };
  }

  /**
   * Get cost summary for a user across all projects.
   */
  async getUserCostSummary(userId, days = 30) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    // LLM costs
    const llmResult = await db('prompt_logs')
      .where('user_id', userId)
      .where('created_at', '>=', sinceDate)
      .select(
        db.raw('SUM(COALESCE(total_cost, 0)) as total'),
        db.raw('COUNT(*) as request_count'),
        db.raw('SUM(COALESCE(total_tokens, 0)) as total_tokens')
      )
      .first();

    // Deployment costs
    const deployResult = await db('deployments')
      .join('projects', 'deployments.project_id', 'projects.id')
      .where('projects.user_id', userId)
      .where('deployments.created_at', '>=', sinceDate)
      .select(
        db.raw('SUM(COALESCE(deployments.cost, 0)) as total'),
        db.raw('COUNT(*) as deploy_count')
      )
      .first();

    // Marketing costs
    const marketingResult = await db('marketing_assets')
      .join('projects', 'marketing_assets.project_id', 'projects.id')
      .where('projects.user_id', userId)
      .where('marketing_assets.created_at', '>=', sinceDate)
      .select(db.raw('SUM(COALESCE(generation_cost, 0)) as total'))
      .first();

    // Daily trend
    const dailyTrend = await db('prompt_logs')
      .where('user_id', userId)
      .where('created_at', '>=', sinceDate)
      .select(
        db.raw("DATE(created_at) as date"),
        db.raw('SUM(COALESCE(total_cost, 0)) as llm_cost'),
        db.raw('COUNT(*) as requests')
      )
      .groupByRaw('DATE(created_at)')
      .orderBy('date', 'asc');

    return {
      period_days: days,
      llm: {
        total_cost: parseFloat(llmResult?.total || 0),
        request_count: parseInt(llmResult?.request_count || 0, 10),
        total_tokens: parseInt(llmResult?.total_tokens || 0, 10),
      },
      deployment: {
        total_cost: parseFloat(deployResult?.total || 0),
        deploy_count: parseInt(deployResult?.deploy_count || 0, 10),
      },
      marketing: {
        total_cost: parseFloat(marketingResult?.total || 0),
      },
      grand_total:
        parseFloat(llmResult?.total || 0) +
        parseFloat(deployResult?.total || 0) +
        parseFloat(marketingResult?.total || 0),
      daily_trend: dailyTrend.map((d) => ({
        date: d.date,
        llm_cost: parseFloat(d.llm_cost),
        requests: parseInt(d.requests, 10),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  async _updateProjectCost(projectId, category, amount) {
    // Update the JSONB cost_breakdown field
    await db('projects')
      .where({ id: projectId })
      .update({
        cost_breakdown: db.raw(
          `jsonb_set(COALESCE(cost_breakdown, '{"llm":0,"deployment":0,"storage":0}')::jsonb, '{${category}}', (COALESCE((cost_breakdown->>'${category}')::numeric, 0) + ?)::text::jsonb)`,
          [amount]
        ),
        estimated_cost: db.raw('COALESCE(estimated_cost, 0) + ?', [amount]),
        updated_at: db.fn.now(),
      });
  }
}

const costTracker = new CostTracker();
module.exports = costTracker;
