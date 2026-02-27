/**
 * Combined worker entry point.
 * Starts all Bull queue processors in a single process for Railway deployment.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../../../.env') });

const logger = require('../../config/logger');

logger.info('Starting all workers...');

require('./buildWorker');
require('./marketingWorker');
require('./deployWorker');
require('./socialWorker');

logger.info('All workers started');
