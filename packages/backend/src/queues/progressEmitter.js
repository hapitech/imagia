const Redis = require('ioredis');
const config = require('../config/environment');
const logger = require('../config/logger');

const CHANNEL = 'imagia:progress';
const subscribers = new Map();

let pubClient = null;
let subClient = null;

function getPubClient() {
  if (!pubClient) {
    pubClient = new Redis(config.redisUrl);
  }
  return pubClient;
}

function getSubClient() {
  if (!subClient) {
    subClient = new Redis(config.redisUrl);
    subClient.subscribe(CHANNEL, (err) => {
      if (err) {
        logger.error('Failed to subscribe to progress channel', { error: err.message });
      }
    });

    subClient.on('message', (channel, message) => {
      if (channel !== CHANNEL) return;

      try {
        const data = JSON.parse(message);
        const { projectId, ...progressData } = data;

        const callbacks = subscribers.get(projectId);
        if (callbacks) {
          callbacks.forEach((cb) => {
            try {
              cb(progressData);
            } catch (err) {
              logger.error('Progress callback error', { error: err.message, projectId });
            }
          });
        }
      } catch (err) {
        logger.error('Failed to parse progress message', { error: err.message });
      }
    });
  }
  return subClient;
}

async function emit(projectId, progressData) {
  try {
    const client = getPubClient();
    await client.publish(CHANNEL, JSON.stringify({ projectId, ...progressData }));
  } catch (err) {
    logger.error('Failed to emit progress', { error: err.message, projectId });
  }
}

function subscribe(projectId, callback) {
  getSubClient();

  if (!subscribers.has(projectId)) {
    subscribers.set(projectId, new Set());
  }
  subscribers.get(projectId).add(callback);

  // Return cleanup function
  return () => {
    const callbacks = subscribers.get(projectId);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        subscribers.delete(projectId);
      }
    }
  };
}

module.exports = { emit, subscribe };
