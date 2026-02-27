const logger = require('../config/logger');

function isRetryableError(error) {
  if (!error) return false;

  // Network errors
  if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return true;
  }

  // Rate limiting
  if (error.status === 429 || error.response?.status === 429) {
    return true;
  }

  // Server errors
  const status = error.status || error.response?.status;
  if (status >= 500 && status < 600) {
    return true;
  }

  return false;
}

async function retryWithBackoff(fn, options = {}) {
  const { maxRetries = 3, baseDelay = 1000, name = 'operation' } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries || !isRetryableError(error)) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      logger.warn(`Retrying ${name}, attempt ${attempt + 1}/${maxRetries}, delay ${Math.round(delay)}ms`, {
        error: error.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

module.exports = { retryWithBackoff, isRetryableError };
