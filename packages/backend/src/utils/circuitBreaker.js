const CircuitBreaker = require('opossum');
const config = require('../config/environment');
const logger = require('../config/logger');

/**
 * Returns true if the error is a client error (4xx) that should NOT
 * count as a circuit-breaker failure. The error still propagates to the
 * caller, but it won't push the breaker toward the open state.
 */
function isClientError(error) {
  // Axios errors
  const status = error.response?.status || error.status || error.statusCode;
  if (status && status >= 400 && status < 500) return true;
  // OpenAI SDK errors carry a status property
  if (error.constructor?.name === 'APIError' && error.status >= 400 && error.status < 500) return true;
  return false;
}

function createCircuitBreaker(fn, name, options = {}) {
  const breaker = new CircuitBreaker(fn, {
    timeout: options.timeout || config.circuitBreakerTimeout,
    errorThresholdPercentage: options.errorThreshold || config.circuitBreakerErrorThreshold,
    resetTimeout: options.resetTimeout || config.circuitBreakerResetTimeout,
    volumeThreshold: options.volumeThreshold || 5,
    rollingCountTimeout: options.rollingCountTimeout || 30000,
    name,
    // Don't count 4xx client errors as failures — they're not transient
    // and shouldn't trip the breaker (e.g. 400 context overflow, 404 model not found)
    errorFilter: (error) => isClientError(error),
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
    const status = error.response?.status || error.status || error.statusCode;
    logger.error(`Circuit breaker failure: ${name}`, { error: error.message, httpStatus: status || 'unknown' });
  });

  breaker.fallback(() => {
    throw new Error(`Service ${name} is currently unavailable (circuit breaker open)`);
  });

  // Register for global access (enables admin reset)
  _breakers.set(name, breaker);

  return breaker;
}

// Global registry for admin operations
const _breakers = new Map();

/**
 * Get all registered circuit breakers and their status.
 */
function getCircuitBreakerStatus() {
  const status = {};
  for (const [name, breaker] of _breakers) {
    status[name] = {
      state: breaker.opened ? 'open' : breaker.halfOpen ? 'half-open' : 'closed',
      stats: breaker.stats ? {
        fires: breaker.stats.fires,
        failures: breaker.stats.failures,
        successes: breaker.stats.successes,
        rejects: breaker.stats.rejects,
        timeouts: breaker.stats.timeouts,
      } : {},
    };
  }
  return status;
}

/**
 * Reset all circuit breakers to closed state.
 */
function resetAllCircuitBreakers() {
  for (const [name, breaker] of _breakers) {
    breaker.close();
    logger.info(`Circuit breaker manually reset: ${name}`);
  }
}

module.exports = { createCircuitBreaker, getCircuitBreakerStatus, resetAllCircuitBreakers };
