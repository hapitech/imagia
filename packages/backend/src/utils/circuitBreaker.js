const CircuitBreaker = require('opossum');
const config = require('../config/environment');
const logger = require('../config/logger');

function createCircuitBreaker(fn, name, options = {}) {
  const breaker = new CircuitBreaker(fn, {
    timeout: options.timeout || config.circuitBreakerTimeout,
    errorThresholdPercentage: options.errorThreshold || config.circuitBreakerErrorThreshold,
    resetTimeout: options.resetTimeout || config.circuitBreakerResetTimeout,
    name,
  });

  breaker.on('open', () => {
    logger.warn(`Circuit breaker OPEN: ${name}`);
  });

  breaker.on('halfOpen', () => {
    logger.info(`Circuit breaker HALF-OPEN: ${name}`);
  });

  breaker.on('close', () => {
    logger.info(`Circuit breaker CLOSED: ${name}`);
  });

  breaker.on('timeout', () => {
    logger.warn(`Circuit breaker timeout: ${name}`);
  });

  breaker.on('reject', () => {
    logger.warn(`Circuit breaker rejected: ${name}`);
  });

  breaker.on('failure', (error) => {
    logger.error(`Circuit breaker failure: ${name}`, { error: error.message });
  });

  breaker.fallback(() => {
    throw new Error(`Service ${name} is currently unavailable (circuit breaker open)`);
  });

  return breaker;
}

module.exports = { createCircuitBreaker };
