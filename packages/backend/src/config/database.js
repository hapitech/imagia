const knex = require('knex');
const knexConfig = require('../db/knexfile');
const config = require('./environment');
const logger = require('./logger');

const environment = config.nodeEnv || 'development';
const db = knex(knexConfig[environment]);

db.on('query', (query) => {
  if (config.logLevel === 'debug') {
    logger.debug('SQL query', { sql: query.sql, bindings: query.bindings });
  }
});

db.on('query-error', (error, query) => {
  logger.error('SQL query error', { error: error.message, sql: query.sql });
});

const testConnection = async () => {
  try {
    await db.raw('SELECT 1');
    logger.info('PostgreSQL connected');
    return true;
  } catch (error) {
    logger.error('PostgreSQL connection failed', { error: error.message });
    return false;
  }
};

const gracefulShutdown = async () => {
  logger.info('Closing PostgreSQL connection');
  await db.destroy();
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = { db, testConnection };
