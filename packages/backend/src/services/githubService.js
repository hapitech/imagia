/**
 * GitHub Service
 *
 * Integrates with GitHub via @octokit/rest to support:
 * - OAuth connection flow (store encrypted access tokens)
 * - Import existing repos as Imagia projects
 * - Push generated code to GitHub repos
 * - Pull latest changes from connected repos
 * - Create new repos from Imagia projects
 * - Check sync status (ahead/behind/diverged)
 */

const { Octokit } = require('@octokit/rest');
const axios = require('axios');
const { db } = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');
const { createCircuitBreaker } = require('../utils/circuitBreaker');
const { retryWithBackoff } = require('../utils/retryLogic');
const config = require('../config/environment');
const logger = require('../config/logger');

class GitHubService {
  constructor() {
    this.breaker = createCircuitBreaker(
      (fn) => fn(),
      'github-api',
      { timeout: 30000 }
    );
    logger.info('GitHubService initialized');
  }

  // ---------------------------------------------------------------------------
  // OAuth
  // ---------------------------------------------------------------------------

  /**
   * Generate the GitHub OAuth authorization URL.
   */
  getAuthorizationUrl(state) {
    const params = new URLSearchParams({
      client_id: config.githubClientId,
      redirect_uri: `${config.frontendUrl}/github/callback`,
      scope: 'repo user:email',
      state,
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange an OAuth code for an access token.
   */
  async exchangeCodeForToken(code) {
    const response = await retryWithBackoff(
      () =>
        axios.post(
          'https://github.com/login/oauth/access_token',
          {
            client_id: config.githubClientId,
            client_secret: config.githubClientSecret,
            code,
          },
          { headers: { Accept: 'application/json' } }
        ),
      { maxRetries: 2, baseDelay: 1000, name: 'github-oauth' }
    );

    const { access_token, error } = response.data;
    if (error || !access_token) {
      throw new Error(`GitHub OAuth error: ${error || 'no token received'}`);
    }

    return access_token;
  }

  /**
   * Save encrypted GitHub access token to the user record.
   */
  async saveUserToken(userId, accessToken) {
    const encrypted = encrypt(accessToken);
    await db('users').where({ id: userId }).update({
      github_access_token: encrypted,
      updated_at: db.fn.now(),
    });
    logger.info('GitHub access token saved', { userId });
  }

  /**
   * Get an authenticated Octokit instance for a user.
   */
  async _getOctokit(userId) {
    const user = await db('users').where({ id: userId }).select('github_access_token').first();
    if (!user?.github_access_token) {
      throw new Error('GitHub account not connected. Please connect your GitHub account first.');
    }
    const token = decrypt(user.github_access_token);
    return new Octokit({ auth: token });
  }

  // ---------------------------------------------------------------------------
  // List repos
  // ---------------------------------------------------------------------------

  /**
   * List the user's GitHub repositories.
   */
  async listRepos(userId, { page = 1, perPage = 30 } = {}) {
    const octokit = await this._getOctokit(userId);

    const result = await retryWithBackoff(
      () =>
        this.breaker.fire(() =>
          octokit.repos.listForAuthenticatedUser({
            sort: 'updated',
            per_page: perPage,
            page,
          })
        ),
      { maxRetries: 1, baseDelay: 1000, name: 'github-list-repos' }
    );

    return result.data.map((repo) => ({
      id: repo.id,
      full_name: repo.full_name,
      name: repo.name,
      owner: repo.owner.login,
      description: repo.description,
      private: repo.private,
      default_branch: repo.default_branch,
      html_url: repo.html_url,
      language: repo.language,
      updated_at: repo.updated_at,
    }));
  }

  // ---------------------------------------------------------------------------
  // Import repo
  // ---------------------------------------------------------------------------

  /**
   * Import an existing GitHub repo as a new Imagia project.
   * Reads all files from the repo and stores them as project_files.
   */
  async importRepo(userId, repoFullName) {
    const octokit = await this._getOctokit(userId);
    const [owner, repo] = repoFullName.split('/');

    logger.info('Importing GitHub repo', { userId, repoFullName });

    // Get repo info
    const repoInfo = await retryWithBackoff(
      () => this.breaker.fire(() => octokit.repos.get({ owner, repo })),
      { maxRetries: 1, baseDelay: 1000, name: 'github-get-repo' }
    );

    const defaultBranch = repoInfo.data.default_branch;

    // Get the full file tree
    const treeResult = await retryWithBackoff(
      () =>
        this.breaker.fire(() =>
          octokit.git.getTree({
            owner,
            repo,
            tree_sha: defaultBranch,
            recursive: 'true',
          })
        ),
      { maxRetries: 1, baseDelay: 1000, name: 'github-get-tree' }
    );

    const files = treeResult.data.tree.filter(
      (item) => item.type === 'blob' && item.size < 500000 // Skip files > 500KB
    );

    // Fetch file contents (limit to 100 files for large repos)
    const filesToFetch = files.slice(0, 100);
    const fileContents = [];

    for (const file of filesToFetch) {
      try {
        const content = await this.breaker.fire(() =>
          octokit.git.getBlob({ owner, repo, file_sha: file.sha })
        );

        // Only process text files
        if (content.data.encoding === 'base64') {
          const decoded = Buffer.from(content.data.content, 'base64').toString('utf-8');
          // Skip binary files (check for null bytes)
          if (!decoded.includes('\0')) {
            fileContents.push({
              file_path: file.path,
              content: decoded,
              language: detectLanguageFromPath(file.path),
            });
          }
        }
      } catch (err) {
        logger.warn('Failed to fetch file from GitHub', {
          file: file.path,
          error: err.message,
        });
      }
    }

    // Get the latest commit SHA
    const latestCommit = await this.breaker.fire(() =>
      octokit.repos.getCommit({ owner, repo, ref: defaultBranch })
    );

    return {
      repoInfo: {
        full_name: repoFullName,
        description: repoInfo.data.description,
        default_branch: defaultBranch,
        language: repoInfo.data.language,
      },
      files: fileContents,
      latestCommitSha: latestCommit.data.sha,
      totalFiles: files.length,
      fetchedFiles: fileContents.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Push to GitHub
  // ---------------------------------------------------------------------------

  /**
   * Push all project files to a connected GitHub repo.
   */
  async pushToGitHub(userId, projectId, commitMessage = 'Update from Imagia') {
    const octokit = await this._getOctokit(userId);

    const connection = await db('github_connections')
      .where({ project_id: projectId })
      .first();

    if (!connection) {
      throw new Error('No GitHub connection found for this project');
    }

    const [owner, repo] = connection.repo_full_name.split('/');
    const branch = connection.default_branch || 'main';

    // Get current project files
    const projectFiles = await db('project_files')
      .where({ project_id: projectId });

    if (projectFiles.length === 0) {
      throw new Error('No project files to push');
    }

    logger.info('Pushing to GitHub', {
      projectId,
      repo: connection.repo_full_name,
      fileCount: projectFiles.length,
    });

    // Get the latest commit on the branch
    const branchRef = await this.breaker.fire(() =>
      octokit.git.getRef({ owner, repo, ref: `heads/${branch}` })
    );
    const latestCommitSha = branchRef.data.object.sha;

    // Get the tree of the latest commit
    const latestCommit = await this.breaker.fire(() =>
      octokit.git.getCommit({ owner, repo, commit_sha: latestCommitSha })
    );
    const baseTreeSha = latestCommit.data.tree.sha;

    // Create blobs for each file
    const treeItems = [];
    for (const file of projectFiles) {
      const blob = await this.breaker.fire(() =>
        octokit.git.createBlob({
          owner,
          repo,
          content: Buffer.from(file.content).toString('base64'),
          encoding: 'base64',
        })
      );

      treeItems.push({
        path: file.file_path,
        mode: '100644',
        type: 'blob',
        sha: blob.data.sha,
      });
    }

    // Create new tree
    const newTree = await this.breaker.fire(() =>
      octokit.git.createTree({
        owner,
        repo,
        base_tree: baseTreeSha,
        tree: treeItems,
      })
    );

    // Create commit
    const newCommit = await this.breaker.fire(() =>
      octokit.git.createCommit({
        owner,
        repo,
        message: commitMessage,
        tree: newTree.data.sha,
        parents: [latestCommitSha],
      })
    );

    // Update branch ref
    await this.breaker.fire(() =>
      octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branch}`,
        sha: newCommit.data.sha,
      })
    );

    // Update connection
    await db('github_connections')
      .where({ project_id: projectId })
      .update({
        last_commit_sha: newCommit.data.sha,
        last_synced_at: db.fn.now(),
        sync_status: 'synced',
        updated_at: db.fn.now(),
      });

    logger.info('Push to GitHub complete', {
      projectId,
      commitSha: newCommit.data.sha,
    });

    return {
      commitSha: newCommit.data.sha,
      commitUrl: `https://github.com/${connection.repo_full_name}/commit/${newCommit.data.sha}`,
    };
  }

  // ---------------------------------------------------------------------------
  // Pull from GitHub
  // ---------------------------------------------------------------------------

  /**
   * Pull latest changes from the connected GitHub repo.
   */
  async pullFromGitHub(userId, projectId) {
    const octokit = await this._getOctokit(userId);

    const connection = await db('github_connections')
      .where({ project_id: projectId })
      .first();

    if (!connection) {
      throw new Error('No GitHub connection found for this project');
    }

    const [owner, repo] = connection.repo_full_name.split('/');
    const branch = connection.default_branch || 'main';

    logger.info('Pulling from GitHub', {
      projectId,
      repo: connection.repo_full_name,
    });

    // Get the latest tree
    const treeResult = await retryWithBackoff(
      () =>
        this.breaker.fire(() =>
          octokit.git.getTree({
            owner,
            repo,
            tree_sha: branch,
            recursive: 'true',
          })
        ),
      { maxRetries: 1, baseDelay: 1000, name: 'github-pull-tree' }
    );

    const files = treeResult.data.tree.filter(
      (item) => item.type === 'blob' && item.size < 500000
    );

    // Get latest commit sha
    const latestCommit = await this.breaker.fire(() =>
      octokit.repos.getCommit({ owner, repo, ref: branch })
    );

    // Fetch and update files
    const updatedFiles = [];
    for (const file of files.slice(0, 100)) {
      try {
        const content = await this.breaker.fire(() =>
          octokit.git.getBlob({ owner, repo, file_sha: file.sha })
        );

        if (content.data.encoding === 'base64') {
          const decoded = Buffer.from(content.data.content, 'base64').toString('utf-8');
          if (!decoded.includes('\0')) {
            updatedFiles.push({
              file_path: file.path,
              content: decoded,
              language: detectLanguageFromPath(file.path),
            });
          }
        }
      } catch (err) {
        logger.warn('Failed to fetch file during pull', {
          file: file.path,
          error: err.message,
        });
      }
    }

    // Update project_files in a transaction
    await db.transaction(async (trx) => {
      // Remove existing files
      await trx('project_files').where({ project_id: projectId }).del();

      // Insert new files
      if (updatedFiles.length > 0) {
        await trx('project_files').insert(
          updatedFiles.map((f) => ({
            project_id: projectId,
            file_path: f.file_path,
            content: f.content,
            language: f.language,
          }))
        );
      }
    });

    // Update connection
    await db('github_connections')
      .where({ project_id: projectId })
      .update({
        last_commit_sha: latestCommit.data.sha,
        last_synced_at: db.fn.now(),
        sync_status: 'synced',
        updated_at: db.fn.now(),
      });

    logger.info('Pull from GitHub complete', {
      projectId,
      fileCount: updatedFiles.length,
      commitSha: latestCommit.data.sha,
    });

    return {
      fileCount: updatedFiles.length,
      commitSha: latestCommit.data.sha,
    };
  }

  // ---------------------------------------------------------------------------
  // Create repo
  // ---------------------------------------------------------------------------

  /**
   * Create a new GitHub repo from an Imagia project.
   */
  async createRepo(userId, projectId, repoName, isPrivate = false) {
    const octokit = await this._getOctokit(userId);

    const project = await db('projects').where({ id: projectId }).first();
    if (!project) throw new Error('Project not found');

    logger.info('Creating GitHub repo', { userId, projectId, repoName });

    // Create the repo
    const repoResult = await this.breaker.fire(() =>
      octokit.repos.createForAuthenticatedUser({
        name: repoName,
        description: project.description || `Generated by Imagia: ${project.name}`,
        private: isPrivate,
        auto_init: true,
      })
    );

    const repoFullName = repoResult.data.full_name;
    const defaultBranch = repoResult.data.default_branch;
    const owner = repoResult.data.owner.login;

    // Push all project files as the initial commit
    const projectFiles = await db('project_files').where({ project_id: projectId });

    if (projectFiles.length > 0) {
      // Get the initial commit
      const branchRef = await this.breaker.fire(() =>
        octokit.git.getRef({
          owner,
          repo: repoName,
          ref: `heads/${defaultBranch}`,
        })
      );

      const latestCommitSha = branchRef.data.object.sha;
      const latestCommit = await this.breaker.fire(() =>
        octokit.git.getCommit({
          owner,
          repo: repoName,
          commit_sha: latestCommitSha,
        })
      );

      // Create blobs
      const treeItems = [];
      for (const file of projectFiles) {
        const blob = await this.breaker.fire(() =>
          octokit.git.createBlob({
            owner,
            repo: repoName,
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64',
          })
        );
        treeItems.push({
          path: file.file_path,
          mode: '100644',
          type: 'blob',
          sha: blob.data.sha,
        });
      }

      // Create tree + commit + update ref
      const newTree = await this.breaker.fire(() =>
        octokit.git.createTree({
          owner,
          repo: repoName,
          base_tree: latestCommit.data.tree.sha,
          tree: treeItems,
        })
      );

      const newCommit = await this.breaker.fire(() =>
        octokit.git.createCommit({
          owner,
          repo: repoName,
          message: 'Initial code from Imagia',
          tree: newTree.data.sha,
          parents: [latestCommitSha],
        })
      );

      await this.breaker.fire(() =>
        octokit.git.updateRef({
          owner,
          repo: repoName,
          ref: `heads/${defaultBranch}`,
          sha: newCommit.data.sha,
        })
      );

      // Create github_connections record
      await db('github_connections').insert({
        project_id: projectId,
        repo_full_name: repoFullName,
        default_branch: defaultBranch,
        last_commit_sha: newCommit.data.sha,
        last_synced_at: db.fn.now(),
        sync_status: 'synced',
      });

      // Update project record
      await db('projects').where({ id: projectId }).update({
        github_repo_url: repoResult.data.html_url,
        github_repo_owner: owner,
        github_repo_name: repoName,
        github_branch: defaultBranch,
        updated_at: db.fn.now(),
      });
    }

    logger.info('GitHub repo created and code pushed', {
      projectId,
      repoFullName,
    });

    return {
      full_name: repoFullName,
      html_url: repoResult.data.html_url,
      default_branch: defaultBranch,
    };
  }

  // ---------------------------------------------------------------------------
  // Sync status
  // ---------------------------------------------------------------------------

  /**
   * Check whether the local project is ahead/behind/synced with the remote.
   */
  async syncStatus(userId, projectId) {
    const octokit = await this._getOctokit(userId);

    const connection = await db('github_connections')
      .where({ project_id: projectId })
      .first();

    if (!connection) {
      return { status: 'not_connected' };
    }

    const [owner, repo] = connection.repo_full_name.split('/');
    const branch = connection.default_branch || 'main';

    try {
      const latestCommit = await this.breaker.fire(() =>
        octokit.repos.getCommit({ owner, repo, ref: branch })
      );

      const remoteSha = latestCommit.data.sha;
      const localSha = connection.last_commit_sha;

      let status;
      if (!localSha) {
        status = 'behind';
      } else if (localSha === remoteSha) {
        status = 'synced';
      } else {
        // We can't easily tell ahead vs behind without comparing commit trees,
        // so mark as diverged if they differ.
        status = 'diverged';
      }

      // Update the connection
      await db('github_connections')
        .where({ project_id: projectId })
        .update({ sync_status: status, updated_at: db.fn.now() });

      return {
        status,
        local_sha: localSha,
        remote_sha: remoteSha,
        repo: connection.repo_full_name,
        last_synced_at: connection.last_synced_at,
      };
    } catch (err) {
      logger.error('Failed to check sync status', {
        projectId,
        error: err.message,
      });
      return { status: 'error', error: err.message };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectLanguageFromPath(filePath) {
  if (!filePath) return null;
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    py: 'python',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'shell',
  };
  if (filePath.endsWith('Dockerfile')) return 'dockerfile';
  return map[ext] || null;
}

const githubService = new GitHubService();
module.exports = githubService;
