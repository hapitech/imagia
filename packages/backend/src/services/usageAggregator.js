/**
 * Usage Aggregator
 *
 * Rolls up prompt_logs into llm_usage_daily for fast analytics queries.
 * Runs as a scheduled job (every hour) or can be invoked manually.
 */

const { db } = require('../config/database');
const logger = require('../config/logger');

/**
 * Aggregate prompt_logs for a given date into llm_usage_daily.
 * Uses upsert (INSERT ON CONFLICT UPDATE) so it's idempotent.
 *
 * @param {string} [dateStr] - ISO date string (YYYY-MM-DD). Defaults to yesterday.
 */
async function aggregateForDate(dateStr) {
  const date = dateStr || getYesterday();
  logger.info('Usage aggregation starting', { date });

  try {
    const rows = await db('prompt_logs')
      .whereRaw('DATE(created_at) = ?', [date])
      .groupBy('user_id', 'provider', 'model')
      .select(
        'user_id',
        'provider',
        'model',
        db.raw('COUNT(*) as request_count'),
        db.raw('COALESCE(SUM(input_tokens), 0) as total_input_tokens'),
        db.raw('COALESCE(SUM(output_tokens), 0) as total_output_tokens'),
        db.raw('COALESCE(SUM(total_cost), 0) as total_cost'),
        db.raw('COALESCE(AVG(latency_ms), 0) as avg_latency_ms'),
        db.raw("COUNT(*) FILTER (WHERE status != 'success') as error_count"),
        db.raw('COUNT(*) FILTER (WHERE cache_hit = true) as cache_hit_count')
      );

    if (rows.length === 0) {
      logger.info('No prompt_logs for date, skipping', { date });
      return { date, upserted: 0 };
    }

    // Upsert each aggregated row
    for (const row of rows) {
      await db.raw(
        `INSERT INTO llm_usage_daily (user_id, date, provider, model, request_count, total_input_tokens, total_output_tokens, total_cost, avg_latency_ms, error_count, cache_hit_count, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON CONFLICT (user_id, date, provider, model)
         DO UPDATE SET
           request_count = EXCLUDED.request_count,
           total_input_tokens = EXCLUDED.total_input_tokens,
           total_output_tokens = EXCLUDED.total_output_tokens,
           total_cost = EXCLUDED.total_cost,
           avg_latency_ms = EXCLUDED.avg_latency_ms,
           error_count = EXCLUDED.error_count,
           cache_hit_count = EXCLUDED.cache_hit_count,
           updated_at = NOW()`,
        [
          row.user_id,
          date,
          row.provider,
          row.model,
          row.request_count,
          row.total_input_tokens,
          row.total_output_tokens,
          row.total_cost,
          row.avg_latency_ms,
          row.error_count,
          row.cache_hit_count,
        ]
      );
    }

    logger.info('Usage aggregation complete', { date, upserted: rows.length });
    return { date, upserted: rows.length };
  } catch (err) {
    logger.error('Usage aggregation failed', { date, error: err.message });
    throw err;
  }
}

/**
 * Backfill aggregates for the last N days.
 */
async function backfill(days = 30) {
  logger.info('Starting usage backfill', { days });
  const results = [];

  for (let i = 0; i < days; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i - 1);
    const dateStr = d.toISOString().split('T')[0];
    const result = await aggregateForDate(dateStr);
    results.push(result);
  }

  logger.info('Backfill complete', { days, totalDates: results.length });
  return results;
}

function getYesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * Start the hourly aggregation interval.
 * Returns a cleanup function to clear the interval.
 */
function startScheduled() {
  // Run immediately for yesterday
  aggregateForDate().catch((err) => {
    logger.error('Scheduled aggregation error', { error: err.message });
  });

  // Also aggregate today's partial data
  const today = new Date().toISOString().split('T')[0];
  aggregateForDate(today).catch((err) => {
    logger.error('Scheduled aggregation error (today)', { error: err.message });
  });

  // Then run every hour
  const interval = setInterval(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    aggregateForDate(todayStr).catch((err) => {
      logger.error('Scheduled aggregation error', { error: err.message });
    });
  }, 60 * 60 * 1000); // 1 hour

  logger.info('Usage aggregator scheduled (hourly)');

  return () => clearInterval(interval);
}

module.exports = {
  aggregateForDate,
  backfill,
  startScheduled,
};
