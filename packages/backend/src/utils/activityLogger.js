class ActivityLogger {
  constructor() {
    this.activities = [];
  }

  log(type, data) {
    this.activities.push({
      type,
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  logLLM(provider, model, taskType, data = {}) {
    this.log('llm', { provider, model, taskType, ...data });
  }

  logAPI(service, endpoint, data = {}) {
    this.log('api', { service, endpoint, ...data });
  }

  logDatabase(operation, table, data = {}) {
    this.log('database', { operation, table, ...data });
  }

  logFunction(name, data = {}) {
    this.log('function', { name, ...data });
  }

  logError(error, context = {}) {
    this.log('error', { message: error.message, stack: error.stack, ...context });
  }

  getActivities() {
    return [...this.activities];
  }

  count() {
    return this.activities.length;
  }

  clear() {
    this.activities = [];
  }
}

module.exports = ActivityLogger;
