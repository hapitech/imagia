/**
 * Railway CLI Service
 *
 * Deploys user-built apps to Railway via the `railway` CLI binary.
 * Used for projects WITHOUT a GitHub connection.
 *
 * Flow:
 *   1. Fetch project files from DB
 *   2. Write them to a temp directory (preserving paths)
 *   3. Ensure Dockerfile + .dockerignore exist
 *   4. Run `railway up -p PROJECT -s SERVICE -e ENV --detach`
 *   5. Clean up temp directory
 *
 * The CLI authenticates via RAILWAY_TOKEN env var.
 * The --detach flag returns immediately after upload; the deploy worker
 * polls for completion separately via the GraphQL API.
 */

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const { db } = require('../config/database');
const config = require('../config/environment');
const logger = require('../config/logger');
const { generateDockerfile, generateDockerignore } = require('../utils/dockerfileGenerator');
const { generateContentHash } = require('../utils/contentHash');

const execFileAsync = promisify(execFile);
const RAILWAY_API = 'https://backboard.railway.app/graphql/v2';

class RailwayCliService {
  constructor() {
    // In the monorepo, the binary is hoisted to root node_modules/.bin/
    this.railwayBin = path.resolve(__dirname, '../../../../node_modules/.bin/railway');
    logger.info('RailwayCliService initialized', { bin: this.railwayBin });
  }

  /**
   * Deploy a project to Railway via CLI.
   *
   * The Railway CLI requires a project-scoped token (not account API token)
   * and a service name (not ID). We create a project token via GraphQL,
   * then run `railway up -s SERVICE_NAME --detach`.
   *
   * @param {Object} options
   * @param {string} options.projectId        - Imagia project UUID
   * @param {string} options.railwayProjectId - Railway project UUID
   * @param {string} options.railwayServiceId - Railway service UUID (for token scoping)
   * @param {string} options.environmentId    - Railway environment UUID
   * @param {string} options.serviceName      - Railway service name (for CLI -s flag)
   * @param {string} options.appType          - Framework type (react, express, etc.)
   * @param {function} [options.onProgress]   - Progress callback(message)
   * @returns {Promise<{ success: boolean }>}
   */
  async deploy(options) {
    const {
      projectId,
      railwayProjectId,
      railwayServiceId,
      environmentId,
      serviceName,
      appType,
      onProgress,
    } = options;

    // Verify CLI binary exists
    try {
      await fs.promises.access(this.railwayBin, fs.constants.X_OK);
    } catch {
      throw new Error(
        `Railway CLI not found at ${this.railwayBin}. ` +
        'Ensure @railway/cli is installed as a dependency.'
      );
    }

    let tmpDir = null;

    try {
      // 1. Create temp directory
      tmpDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), `imagia-deploy-${projectId.substring(0, 8)}-`)
      );
      logger.info('Created temp dir for CLI deploy', { tmpDir, projectId });

      if (onProgress) onProgress('Writing project files to disk...');

      // 2. Fetch all project files from DB
      const files = await db('project_files')
        .where({ project_id: projectId })
        .select('file_path', 'content');

      if (files.length === 0) {
        throw new Error('No project files found for deployment');
      }

      // 3. Write files to temp directory (preserving paths)
      let hasDockerfile = false;
      let hasDockerignore = false;

      for (const file of files) {
        const fullPath = path.join(tmpDir, file.file_path);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, file.content, 'utf-8');

        if (file.file_path === 'Dockerfile') hasDockerfile = true;
        if (file.file_path === '.dockerignore') hasDockerignore = true;
      }

      logger.info('Wrote project files to temp dir', {
        projectId,
        fileCount: files.length,
        tmpDir,
      });

      // 4. Generate Dockerfile if missing
      if (!hasDockerfile) {
        const dockerfileContent = generateDockerfile(appType);
        await fs.promises.writeFile(
          path.join(tmpDir, 'Dockerfile'),
          dockerfileContent,
          'utf-8'
        );
        logger.info('Generated Dockerfile for deploy', { appType, projectId });

        // Save to DB so it persists
        await this._saveFileToDb(projectId, 'Dockerfile', dockerfileContent, 'dockerfile');
      }

      // 5. Generate .dockerignore if missing
      if (!hasDockerignore) {
        const dockerignoreContent = generateDockerignore();
        await fs.promises.writeFile(
          path.join(tmpDir, '.dockerignore'),
          dockerignoreContent,
          'utf-8'
        );
      }

      // 6. Write .railwayignore
      await fs.promises.writeFile(
        path.join(tmpDir, '.railwayignore'),
        'node_modules\n.env\n.env.local\n.git\n',
        'utf-8'
      );

      if (onProgress) onProgress('Uploading source to Railway...');

      // 7. Create a project-scoped token for the CLI
      //    The Railway CLI requires a project token, not the account API token.
      const projectToken = await this._createProjectToken(
        railwayProjectId,
        environmentId
      );

      // 8. Run `railway up` with service name (CLI requires name, not ID)
      const env = {
        ...process.env,
        RAILWAY_TOKEN: projectToken,
      };

      const args = [
        'up',
        '-s', serviceName || railwayServiceId,
        '--detach',
      ];

      logger.info('Executing railway up', {
        projectId,
        railwayProjectId,
        serviceName,
        args: args.join(' '),
      });

      const { stdout, stderr } = await execFileAsync(this.railwayBin, args, {
        cwd: tmpDir,
        env,
        timeout: 120000, // 2 min for upload
      });

      logger.info('railway up completed', {
        projectId,
        stdout: stdout.substring(0, 500),
        stderr: stderr.substring(0, 500),
      });

      return { success: true };
    } finally {
      // 8. Always clean up temp directory
      if (tmpDir) {
        try {
          await fs.promises.rm(tmpDir, { recursive: true, force: true });
          logger.info('Cleaned up temp dir', { tmpDir });
        } catch (cleanupErr) {
          logger.warn('Failed to clean up temp dir', {
            tmpDir,
            error: cleanupErr.message,
          });
        }
      }
    }
  }

  /**
   * Create a project-scoped token via Railway GraphQL API.
   * The Railway CLI requires this (account API tokens are rejected by `railway up`).
   * @private
   */
  async _createProjectToken(railwayProjectId, environmentId) {
    const response = await axios.post(
      RAILWAY_API,
      {
        query: `mutation($input: ProjectTokenCreateInput!) {
          projectTokenCreate(input: $input)
        }`,
        variables: {
          input: {
            projectId: railwayProjectId,
            environmentId,
            name: `imagia-deploy-${Date.now()}`,
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${config.railwayApiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    );

    if (response.data.errors) {
      const errMsg = response.data.errors.map((e) => e.message).join('; ');
      throw new Error(`Failed to create Railway project token: ${errMsg}`);
    }

    const token = response.data.data.projectTokenCreate;
    logger.info('Created Railway project token for CLI deploy', { railwayProjectId });
    return token;
  }

  /**
   * Save a generated file (Dockerfile, etc.) to the project_files table.
   * @private
   */
  async _saveFileToDb(projectId, filePath, content, language) {
    const fileSize = Buffer.byteLength(content, 'utf-8');
    const checksum = generateContentHash(content);

    const existing = await db('project_files')
      .where({ project_id: projectId, file_path: filePath })
      .first();

    if (existing) {
      await db('project_files')
        .where({ id: existing.id })
        .update({ content, language, file_size: fileSize, checksum, updated_at: db.fn.now() });
    } else {
      await db('project_files').insert({
        project_id: projectId,
        file_path: filePath,
        content,
        language,
        file_size: fileSize,
        checksum,
      });
    }
  }
}

const railwayCliService = new RailwayCliService();
module.exports = railwayCliService;
