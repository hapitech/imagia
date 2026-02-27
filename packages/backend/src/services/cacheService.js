const NodeCache = require('node-cache');
const { createRedisClient } = require('../config/redis');
const logger = require('../config/logger');
const config = require('../config/environment');

class CacheService {
  constructor() {
    // L1: In-memory cache (node-cache)
    this.l1 = new NodeCache({
      maxKeys: 100,
      stdTTL: 3600, // 1 hour default TTL
      checkperiod: 120,
      useClones: true,
    });

    // L2: Redis
    this.redis = createRedisClient();

    // Metrics
    this.stats = {
      l1Hits: 0,
      l1Misses: 0,
      l2Hits: 0,
      l2Misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
    };

    this.l1.on('expired', (key) => {
      logger.debug('L1 cache key expired', { key });
    });
  }

  /**
   * Get a value from cache. Tries L1 first, then L2.
   * Populates L1 on L2 hit.
   */
  async get(key) {
    try {
      // Try L1 first
      const l1Value = this.l1.get(key);
      if (l1Value !== undefined) {
        this.stats.l1Hits++;
        logger.debug('Cache L1 hit', { key });
        return l1Value;
      }
      this.stats.l1Misses++;

      // Try L2 (Redis)
      const l2Value = await this.redis.get(key);
      if (l2Value !== null) {
        this.stats.l2Hits++;
        logger.debug('Cache L2 hit', { key });

        const parsed = JSON.parse(l2Value);

        // Populate L1 from L2 hit
        const ttl = await this.redis.ttl(key);
        if (ttl > 0) {
          this.l1.set(key, parsed, Math.min(ttl, 3600));
        } else {
          this.l1.set(key, parsed);
        }

        return parsed;
      }
      this.stats.l2Misses++;

      logger.debug('Cache miss', { key });
      return null;
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache get error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Store a value in both L1 and L2 caches.
   */
  async set(key, value, ttl) {
    try {
      const effectiveTtl = ttl || config.cacheTtlLlm;

      // L1: cap at 1 hour
      this.l1.set(key, value, Math.min(effectiveTtl, 3600));

      // L2: full TTL in Redis
      const serialized = JSON.stringify(value);
      await this.redis.setex(key, effectiveTtl, serialized);

      this.stats.sets++;
      logger.debug('Cache set', { key, ttl: effectiveTtl });
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache set error', { key, error: error.message });
    }
  }

  /**
   * Delete a key from both L1 and L2 caches.
   */
  async del(key) {
    try {
      this.l1.del(key);
      await this.redis.del(key);
      this.stats.deletes++;
      logger.debug('Cache delete', { key });
    } catch (error) {
      this.stats.errors++;
      logger.error('Cache delete error', { key, error: error.message });
    }
  }

  /**
   * Cache-aside pattern: get from cache or fetch and store.
   */
  async getOrFetch(key, fetchFn, ttl) {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetchFn();

    if (value !== null && value !== undefined) {
      await this.set(key, value, ttl);
    }

    return value;
  }

  /**
   * Get cache hit/miss metrics.
   */
  getStats() {
    const totalL1 = this.stats.l1Hits + this.stats.l1Misses;
    const totalL2 = this.stats.l2Hits + this.stats.l2Misses;

    return {
      l1: {
        hits: this.stats.l1Hits,
        misses: this.stats.l1Misses,
        hitRate: totalL1 > 0 ? (this.stats.l1Hits / totalL1 * 100).toFixed(2) + '%' : 'N/A',
        keys: this.l1.keys().length,
      },
      l2: {
        hits: this.stats.l2Hits,
        misses: this.stats.l2Misses,
        hitRate: totalL2 > 0 ? (this.stats.l2Hits / totalL2 * 100).toFixed(2) + '%' : 'N/A',
      },
      sets: this.stats.sets,
      deletes: this.stats.deletes,
      errors: this.stats.errors,
    };
  }
}

// Singleton instance
const cacheService = new CacheService();

module.exports = cacheService;
