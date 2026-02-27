/**
 * Railway Service
 *
 * Integrates with Railway's public API (GraphQL) to deploy user-generated apps.
 * Handles project creation, service deployment, status polling, and URL retrieval.
 *
 * Railway API docs: https://docs.railway.app/reference/public-api
 */

const axios = require('axios');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { retryWithBackoff } = require('../utils/retryLogic');
const config = require('../config/environment');
const logger = require('../config/logger');

const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

class RailwayService {
  constructor() {
    this.client = axios.create({
      baseURL: RAILWAY_API,
      headers: {
        Authorization: `Bearer ${config.railwayApiToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });

    this.breaker = createCircuitBreaker(
      (params) => this._gql(params),
      'railway-api',
      { timeout: 60000 }
    );

    logger.info('RailwayService initialized');
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  /**
   * Create a new Railway project for the user's app.
   */
  async createProject(name) {
    const result = await this._query(
      `mutation($input: ProjectCreateInput!) {
        projectCreate(input: $input) {
          id
          name
        }
      }`,
      { input: { name, description: `Imagia app: ${name}` } }
    );

    const project = result.projectCreate;
    logger.info('Railway project created', { railwayProjectId: project.id, name });
    return project;
  }

  /**
   * Create a service within a Railway project.
   */
  async createService(railwayProjectId, name) {
    // First, get the default environment
    const envResult = await this._query(
      `query($projectId: String!) {
        project(id: $projectId) {
          environments {
            edges {
              node { id name }
            }
          }
        }
      }`,
      { projectId: railwayProjectId }
    );

    const envEdges = envResult.project?.environments?.edges || [];
    const prodEnv = envEdges.find((e) => e.node.name === 'production') || envEdges[0];
    const environmentId = prodEnv?.node?.id;

    if (!environmentId) {
      throw new Error('No environment found in Railway project');
    }

    const result = await this._query(
      `mutation($input: ServiceCreateInput!) {
        serviceCreate(input: $input) {
          id
          name
        }
      }`,
      { input: { projectId: railwayProjectId, name } }
    );

    const service = result.serviceCreate;
    logger.info('Railway service created', {
      railwayProjectId,
      serviceId: service.id,
      environmentId,
    });

    return { ...service, environmentId };
  }

  /**
   * Set environment variables on a Railway service.
   */
  async setEnvironmentVariables(railwayProjectId, environmentId, serviceId, variables) {
    await this._query(
      `mutation($input: VariableCollectionUpsertInput!) {
        variableCollectionUpsert(input: $input)
      }`,
      {
        input: {
          projectId: railwayProjectId,
          environmentId,
          serviceId,
          variables,
        },
      }
    );

    logger.info('Railway env vars set', {
      railwayProjectId,
      serviceId,
      varCount: Object.keys(variables).length,
    });
  }

  /**
   * Deploy code to a Railway service from a GitHub repo or source upload.
   * For Imagia, we create a temporary GitHub repo and connect it, or use
   * the Railway source upload if available.
   *
   * For now, we use the serviceInstanceDeploy approach with a Dockerfile
   * that the builder has already generated.
   */
  async deployFromSource(railwayProjectId, serviceId, environmentId) {
    const result = await this._query(
      `mutation($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeploy(serviceId: $serviceId, environmentId: $environmentId)
      }`,
      { serviceId, environmentId }
    );

    logger.info('Railway deployment triggered', {
      railwayProjectId,
      serviceId,
    });

    return result.serviceInstanceDeploy;
  }

  /**
   * Connect a GitHub repo to a Railway service.
   */
  async connectGitHubRepo(railwayProjectId, serviceId, repoFullName, branch = 'main') {
    const result = await this._query(
      `mutation($input: ServiceConnectInput!) {
        serviceConnect(input: $input) {
          id
        }
      }`,
      {
        input: {
          id: serviceId,
          projectId: railwayProjectId,
          repo: repoFullName,
          branch,
        },
      }
    );

    logger.info('Railway service connected to GitHub', {
      railwayProjectId,
      serviceId,
      repo: repoFullName,
    });

    return result.serviceConnect;
  }

  /**
   * Get the deployment status and URL of a service.
   */
  async getServiceStatus(railwayProjectId, serviceId) {
    const result = await this._query(
      `query($projectId: String!) {
        project(id: $projectId) {
          services {
            edges {
              node {
                id
                name
                serviceInstances {
                  edges {
                    node {
                      domains {
                        serviceDomains { domain }
                        customDomains { domain status }
                      }
                      latestDeployment {
                        id
                        status
                        createdAt
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`,
      { projectId: railwayProjectId }
    );

    const services = result.project?.services?.edges || [];
    const service = services.find((s) => s.node.id === serviceId);

    if (!service) {
      return { status: 'not_found', url: null };
    }

    const instance = service.node.serviceInstances?.edges?.[0]?.node;
    const deployment = instance?.latestDeployment;
    const serviceDomains = instance?.domains?.serviceDomains || [];
    const customDomains = instance?.domains?.customDomains || [];

    const domain = serviceDomains[0]?.domain || customDomains[0]?.domain;
    const url = domain ? `https://${domain}` : null;

    return {
      status: deployment?.status || 'unknown',
      deploymentId: deployment?.id,
      url,
      createdAt: deployment?.createdAt,
    };
  }

  /**
   * Generate a domain for a service (Railway auto-generated .up.railway.app domain).
   */
  async generateDomain(serviceId, environmentId) {
    const result = await this._query(
      `mutation($input: ServiceDomainCreateInput!) {
        serviceDomainCreate(input: $input) {
          domain
        }
      }`,
      { input: { serviceId, environmentId } }
    );

    const domain = result.serviceDomainCreate?.domain;
    logger.info('Railway domain generated', { serviceId, domain });
    return domain ? `https://${domain}` : null;
  }

  /**
   * Add a custom domain to a service.
   */
  async addCustomDomain(serviceId, environmentId, domain) {
    const result = await this._query(
      `mutation($input: CustomDomainCreateInput!) {
        customDomainCreate(input: $input) {
          domain
          status { dnsRecords { type hostlabel value } }
        }
      }`,
      { input: { serviceId, environmentId, domain } }
    );

    logger.info('Railway custom domain added', { serviceId, domain });
    return result.customDomainCreate;
  }

  /**
   * Get deployment logs.
   */
  async getDeploymentLogs(deploymentId) {
    const result = await this._query(
      `query($deploymentId: String!) {
        deploymentLogs(deploymentId: $deploymentId, limit: 200) {
          message
          timestamp
          severity
        }
      }`,
      { deploymentId }
    );

    return result.deploymentLogs || [];
  }

  /**
   * Delete a Railway project.
   */
  async deleteProject(railwayProjectId) {
    await this._query(
      `mutation($id: String!) {
        projectDelete(id: $id)
      }`,
      { id: railwayProjectId }
    );

    logger.info('Railway project deleted', { railwayProjectId });
  }

  /**
   * Poll deployment status until it reaches a terminal state.
   * @param {string} railwayProjectId
   * @param {string} serviceId
   * @param {number} [maxWaitMs=600000] - Max 10 minutes
   * @param {number} [intervalMs=10000] - Check every 10 seconds
   * @param {function} [onProgress] - Optional progress callback
   * @returns {Promise<{status: string, url: string|null}>}
   */
  async waitForDeployment(railwayProjectId, serviceId, maxWaitMs = 600000, intervalMs = 10000, onProgress) {
    const startTime = Date.now();
    const terminalStatuses = ['SUCCESS', 'FAILED', 'CRASHED', 'REMOVED', 'CANCELLED'];

    while (Date.now() - startTime < maxWaitMs) {
      const status = await this.getServiceStatus(railwayProjectId, serviceId);

      if (onProgress) {
        onProgress(status);
      }

      if (terminalStatuses.includes(status.status)) {
        return status;
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return { status: 'TIMEOUT', url: null };
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  async _query(query, variables = {}) {
    return retryWithBackoff(
      () => this.breaker.fire({ query, variables }),
      { maxRetries: 2, baseDelay: 2000, name: 'railway-gql' }
    );
  }

  async _gql({ query, variables }) {
    const response = await this.client.post('', { query, variables });

    if (response.data.errors) {
      const errMsg = response.data.errors.map((e) => e.message).join('; ');
      logger.error('Railway GraphQL error', { errors: response.data.errors });
      throw new Error(`Railway API error: ${errMsg}`);
    }

    return response.data.data;
  }
}

const railwayService = new RailwayService();
module.exports = railwayService;
