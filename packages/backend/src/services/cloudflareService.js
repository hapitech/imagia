/**
 * Cloudflare Service
 *
 * Integrates with Cloudflare APIs to manage:
 * - Workers KV: subdomain → Railway URL routing mappings
 * - DNS Records: CNAME records for custom domains
 * - Custom Hostnames (Cloudflare for SaaS): SSL for user custom domains
 */

// cloudflare npm package v3+ is ESM-only, use dynamic import
let Cloudflare;
const cloudflareReady = import('cloudflare').then((mod) => {
  Cloudflare = mod.default || mod.Cloudflare;
});

const axios = require('axios');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { retryWithBackoff } = require('../utils/retryLogic');
const config = require('../config/environment');
const logger = require('../config/logger');

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

class CloudflareService {
  constructor() {
    this.breaker = createCircuitBreaker(
      (fn) => fn(),
      'cloudflare-api',
      { timeout: 30000 }
    );
    this.ready = cloudflareReady;
    this._client = null;
    logger.info('CloudflareService initialized');
  }

  /**
   * Get or create the Cloudflare SDK client.
   */
  async _getClient() {
    await this.ready;
    if (!this._client) {
      this._client = new Cloudflare({
        apiToken: config.cloudflareApiToken,
      });
    }
    return this._client;
  }

  /**
   * Make a raw API call with axios (for KV operations the SDK is cumbersome).
   */
  async _api(method, path, data) {
    return retryWithBackoff(
      () => this.breaker.fire(async () => {
        const response = await axios({
          method,
          url: `${CF_API_BASE}${path}`,
          headers: {
            Authorization: `Bearer ${config.cloudflareApiToken}`,
            'Content-Type': 'application/json',
          },
          data,
          timeout: 15000,
        });
        if (response.data && !response.data.success && response.data.errors?.length) {
          const msg = response.data.errors.map((e) => e.message).join('; ');
          throw new Error(`Cloudflare API error: ${msg}`);
        }
        return response.data;
      }),
      { maxRetries: 2, baseDelay: 2000, name: 'cloudflare-api' }
    );
  }

  // ---------------------------------------------------------------------------
  // Workers KV — subdomain → Railway URL routing
  // ---------------------------------------------------------------------------

  /**
   * Write a subdomain→URL mapping to Workers KV.
   * @param {string} key - The subdomain slug (e.g. "my-todo-app")
   * @param {string} value - The target Railway URL (e.g. "https://app-xyz.up.railway.app")
   */
  async putKvEntry(key, value) {
    const { cloudflareAccountId, cloudflareKvNamespaceId } = config;
    if (!cloudflareAccountId || !cloudflareKvNamespaceId) {
      logger.warn('Cloudflare KV not configured, skipping putKvEntry', { key });
      return;
    }

    logger.info('Writing KV entry', { key, value });

    // KV values are written as raw text, not JSON
    await retryWithBackoff(
      () => this.breaker.fire(async () => {
        await axios({
          method: 'PUT',
          url: `${CF_API_BASE}/accounts/${cloudflareAccountId}/storage/kv/namespaces/${cloudflareKvNamespaceId}/values/${encodeURIComponent(key)}`,
          headers: {
            Authorization: `Bearer ${config.cloudflareApiToken}`,
            'Content-Type': 'text/plain',
          },
          data: value,
          timeout: 15000,
        });
      }),
      { maxRetries: 2, baseDelay: 2000, name: 'cloudflare-kv-put' }
    );

    logger.info('KV entry written', { key });
  }

  /**
   * Read a subdomain→URL mapping from Workers KV.
   * @param {string} key - The subdomain slug
   * @returns {Promise<string|null>} The target URL or null if not found
   */
  async getKvEntry(key) {
    const { cloudflareAccountId, cloudflareKvNamespaceId } = config;
    if (!cloudflareAccountId || !cloudflareKvNamespaceId) {
      return null;
    }

    try {
      const response = await retryWithBackoff(
        () => this.breaker.fire(async () => {
          return axios({
            method: 'GET',
            url: `${CF_API_BASE}/accounts/${cloudflareAccountId}/storage/kv/namespaces/${cloudflareKvNamespaceId}/values/${encodeURIComponent(key)}`,
            headers: {
              Authorization: `Bearer ${config.cloudflareApiToken}`,
            },
            timeout: 15000,
          });
        }),
        { maxRetries: 2, baseDelay: 2000, name: 'cloudflare-kv-get' }
      );
      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete a subdomain→URL mapping from Workers KV.
   * @param {string} key - The subdomain slug
   */
  async deleteKvEntry(key) {
    const { cloudflareAccountId, cloudflareKvNamespaceId } = config;
    if (!cloudflareAccountId || !cloudflareKvNamespaceId) {
      logger.warn('Cloudflare KV not configured, skipping deleteKvEntry', { key });
      return;
    }

    logger.info('Deleting KV entry', { key });

    try {
      await this._api(
        'DELETE',
        `/accounts/${cloudflareAccountId}/storage/kv/namespaces/${cloudflareKvNamespaceId}/values/${encodeURIComponent(key)}`
      );
      logger.info('KV entry deleted', { key });
    } catch (error) {
      if (error.response?.status === 404) {
        logger.info('KV entry not found (already deleted)', { key });
        return;
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // DNS Records
  // ---------------------------------------------------------------------------

  /**
   * Create a DNS record in the Cloudflare zone.
   * @param {string} type - Record type (CNAME, A, etc.)
   * @param {string} name - Record name (e.g. "myapp" or "app.usersite.com")
   * @param {string} content - Record content/target
   * @param {boolean} proxied - Whether to proxy through Cloudflare
   * @returns {Promise<{id: string, name: string, type: string}>}
   */
  async createDnsRecord(type, name, content, proxied = true) {
    const { cloudflareZoneId } = config;
    if (!cloudflareZoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID not configured');
    }

    logger.info('Creating DNS record', { type, name, content, proxied });

    const result = await this._api('POST', `/zones/${cloudflareZoneId}/dns_records`, {
      type,
      name,
      content,
      proxied,
      ttl: proxied ? 1 : 300, // auto TTL when proxied
    });

    logger.info('DNS record created', { id: result.result.id, name });
    return result.result;
  }

  /**
   * Delete a DNS record by ID.
   * @param {string} recordId - The Cloudflare DNS record ID
   */
  async deleteDnsRecord(recordId) {
    const { cloudflareZoneId } = config;
    if (!cloudflareZoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID not configured');
    }

    logger.info('Deleting DNS record', { recordId });

    try {
      await this._api('DELETE', `/zones/${cloudflareZoneId}/dns_records/${recordId}`);
      logger.info('DNS record deleted', { recordId });
    } catch (error) {
      if (error.response?.status === 404) {
        logger.info('DNS record not found (already deleted)', { recordId });
        return;
      }
      throw error;
    }
  }

  /**
   * List DNS records matching a name.
   * @param {string} name - Record name to filter by
   * @returns {Promise<Array>}
   */
  async listDnsRecords(name) {
    const { cloudflareZoneId } = config;
    if (!cloudflareZoneId) {
      return [];
    }

    const result = await this._api(
      'GET',
      `/zones/${cloudflareZoneId}/dns_records?name=${encodeURIComponent(name)}`
    );
    return result.result || [];
  }

  // ---------------------------------------------------------------------------
  // Custom Hostnames (Cloudflare for SaaS)
  // ---------------------------------------------------------------------------

  /**
   * Create a Custom Hostname for a user's custom domain.
   * This enables SSL provisioning for domains like app.usersite.com.
   *
   * @param {string} hostname - The custom domain (e.g. "app.usersite.com")
   * @returns {Promise<{id: string, hostname: string, ssl: Object, status: string}>}
   */
  async createCustomHostname(hostname) {
    const { cloudflareZoneId } = config;
    if (!cloudflareZoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID not configured');
    }

    logger.info('Creating custom hostname', { hostname });

    const result = await this._api('POST', `/zones/${cloudflareZoneId}/custom_hostnames`, {
      hostname,
      ssl: {
        method: 'http',
        type: 'dv',
        settings: {
          min_tls_version: '1.2',
        },
      },
    });

    logger.info('Custom hostname created', {
      id: result.result.id,
      hostname,
      sslStatus: result.result.ssl?.status,
    });

    return result.result;
  }

  /**
   * Get the status of a Custom Hostname (check SSL provisioning).
   * @param {string} hostnameId - The Cloudflare Custom Hostname ID
   * @returns {Promise<{id: string, hostname: string, ssl: Object, status: string}>}
   */
  async getCustomHostname(hostnameId) {
    const { cloudflareZoneId } = config;
    if (!cloudflareZoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID not configured');
    }

    const result = await this._api(
      'GET',
      `/zones/${cloudflareZoneId}/custom_hostnames/${hostnameId}`
    );
    return result.result;
  }

  /**
   * Delete a Custom Hostname.
   * @param {string} hostnameId - The Cloudflare Custom Hostname ID
   */
  async deleteCustomHostname(hostnameId) {
    const { cloudflareZoneId } = config;
    if (!cloudflareZoneId) {
      throw new Error('CLOUDFLARE_ZONE_ID not configured');
    }

    logger.info('Deleting custom hostname', { hostnameId });

    try {
      await this._api('DELETE', `/zones/${cloudflareZoneId}/custom_hostnames/${hostnameId}`);
      logger.info('Custom hostname deleted', { hostnameId });
    } catch (error) {
      if (error.response?.status === 404) {
        logger.info('Custom hostname not found (already deleted)', { hostnameId });
        return;
      }
      throw error;
    }
  }
}

// Singleton instance
const cloudflareService = new CloudflareService();

module.exports = cloudflareService;
