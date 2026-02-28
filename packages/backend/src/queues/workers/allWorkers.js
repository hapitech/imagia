/**
 * Combined worker entry point.
 * Starts all Bull queue processors in a single process for Railway deployment.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../../../.env') });

const logger = require('../../config/logger');

const modelResearchCron = require('../../services/modelResearchCron');
const usageAggregator = require('../../services/usageAggregator');

logger.info('Starting all workers...');

require('./buildWorker');
require('./marketingWorker');
require('./deployWorker');
require('./socialWorker');

// Start scheduled jobs
usageAggregator.startScheduled();
modelResearchCron.startScheduled();

logger.info('All workers started (including cron jobs)');
