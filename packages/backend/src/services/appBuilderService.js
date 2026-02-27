const { db } = require('../config/database');
const logger = require('../config/logger');
const codeGeneratorService = require('./codeGeneratorService');
const contextService = require('./contextService');
const progressEmitter = require('../queues/progressEmitter');
const { generateContentHash } = require('../utils/contentHash');

class AppBuilderService {
  /**
   * Build a new app from a user message. This is the main entry point called
   * by buildWorker for a NEW build (first message or fresh build).
   *
   * Runs the full pipeline: requirements analysis -> scaffold -> code generation
   * -> config files -> version snapshot -> context update -> finalize.
   *
   * @param {Object} options
   * @param {string} options.projectId
   * @param {string} options.conversationId
   * @param {string} options.messageId
   * @param {string} options.userId
   * @param {string} [options.correlationId]
   * @returns {Promise<{success: boolean, filesCreated: number, requirements: Object}>}
   */
  async buildFromMessage(options) {
    const { projectId, conversationId, messageId, userId, correlationId } = options;

    logger.info('Starting build from message', {
      projectId,
      conversationId,
      messageId,
      correlationId,
    });

    const trackerOptions = { projectId, userId, correlationId };

    try {
      // ---------------------------------------------------------------
      // Stage 1: Understand Requirements (0-10%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 2,
        stage: 'understanding',
        message: 'Analyzing your requirements...',
      });

      const userMessage = await this._getUserMessage(messageId);
      const contextMd = await contextService.getContext(projectId) || '';
      const requirements = await codeGeneratorService.analyzeRequirements(
        userMessage,
        contextMd,
        trackerOptions
      );

      // Store requirements in project settings
      await db('projects')
        .where('id', projectId)
        .update({
          settings: JSON.stringify({
            ...(await this._getProjectSettings(projectId)),
            requirements,
          }),
          app_type: requirements.framework || requirements.appType || null,
          status: 'building',
          build_started_at: db.fn.now(),
          updated_at: db.fn.now(),
        });

      // Store assistant message summarizing what will be built
      const requirementsSummary = this._buildRequirementsSummary(requirements);
      await this._storeAssistantMessage(conversationId, requirementsSummary, {
        type: 'requirements-analysis',
        requirements,
      });

      await progressEmitter.emit(projectId, {
        progress: 10,
        stage: 'understanding',
        message: 'Requirements analyzed',
      });

      // ---------------------------------------------------------------
      // Stage 2: Generate Scaffold (10-20%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 12,
        stage: 'scaffold',
        message: 'Creating project scaffold...',
      });

      const { files: scaffoldFiles } =
        await codeGeneratorService.generateScaffold(requirements, trackerOptions);

      for (const file of scaffoldFiles) {
        await this._saveFile(projectId, file);
      }

      await progressEmitter.emit(projectId, {
        progress: 20,
        stage: 'scaffold',
        message: `Created ${scaffoldFiles.length} scaffold files`,
      });

      // ---------------------------------------------------------------
      // Stage 3: Generate Core Code (20-70%)
      // ---------------------------------------------------------------
      const filePlan = this._buildFilePlan(requirements);
      const totalPlanFiles = filePlan.length;
      let generatedCount = scaffoldFiles.length;

      for (let i = 0; i < filePlan.length; i++) {
        const fileSpec = filePlan[i];
        const progressPct = 20 + Math.round(((i + 1) / totalPlanFiles) * 50);

        await progressEmitter.emit(projectId, {
          progress: Math.min(progressPct, 70),
          stage: 'generating',
          message: `Generating ${fileSpec.path}...`,
        });

        const existingFiles = await this._getProjectFiles(projectId);

        const generated = await codeGeneratorService.generateFile(
          requirements,
          existingFiles,
          fileSpec,
          contextMd,
          trackerOptions
        );

        await this._saveFile(projectId, generated);
        generatedCount++;
      }

      await progressEmitter.emit(projectId, {
        progress: 70,
        stage: 'generating',
        message: `Generated ${generatedCount} files`,
      });

      // ---------------------------------------------------------------
      // Stage 4: Generate Config Files (70-75%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 71,
        stage: 'config',
        message: 'Generating configuration files...',
      });

      const configSpecs = this._buildConfigFileSpecs(requirements);

      if (configSpecs.length > 0) {
        const { files: configFiles } = await codeGeneratorService.generateBatchFiles(
          requirements,
          configSpecs,
          contextMd,
          trackerOptions
        );

        for (const file of configFiles) {
          await this._saveFile(projectId, file);
          generatedCount++;
        }
      }

      await progressEmitter.emit(projectId, {
        progress: 75,
        stage: 'config',
        message: 'Configuration files created',
      });

      // ---------------------------------------------------------------
      // Stage 5: Create Version Snapshot (75-80%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 76,
        stage: 'versioning',
        message: 'Creating version snapshot...',
      });

      const allFiles = await this._getProjectFiles(projectId);
      const versionNumber = await this._getNextVersionNumber(projectId);

      const snapshot = allFiles.map((f) => ({
        path: f.path,
        checksum: generateContentHash(f.content),
        language: f.language,
      }));

      await db('project_versions').insert({
        project_id: projectId,
        version_number: versionNumber,
        snapshot: JSON.stringify(snapshot),
        prompt_summary: userMessage,
      });

      await progressEmitter.emit(projectId, {
        progress: 80,
        stage: 'versioning',
        message: `Version ${versionNumber} created`,
      });

      // ---------------------------------------------------------------
      // Stage 6: Update Context (80-85%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 81,
        stage: 'context',
        message: 'Building project context...',
      });

      try {
        await contextService.buildContextFromHistory(projectId);
      } catch (contextError) {
        // Context generation is non-critical; log and continue
        logger.warn('Failed to build context from history', {
          projectId,
          error: contextError.message,
        });
      }

      await progressEmitter.emit(projectId, {
        progress: 85,
        stage: 'context',
        message: 'Project context updated',
      });

      // ---------------------------------------------------------------
      // Stage 7: Finalize (85-100%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 90,
        stage: 'finalizing',
        message: 'Finalizing build...',
      });

      await db('projects')
        .where('id', projectId)
        .update({
          status: 'draft',
          build_progress: 100,
          current_build_stage: 'complete',
          updated_at: db.fn.now(),
        });

      const completionMessage = this._buildCompletionMessage(requirements, generatedCount);
      await this._storeAssistantMessage(conversationId, completionMessage, {
        type: 'build-complete',
        filesCreated: generatedCount,
        versionNumber,
      });

      await progressEmitter.emit(projectId, {
        progress: 100,
        stage: 'complete',
        message: 'Build complete!',
      });

      logger.info('Build completed successfully', {
        projectId,
        correlationId,
        filesCreated: generatedCount,
        versionNumber,
      });

      return {
        success: true,
        filesCreated: generatedCount,
        requirements,
      };
    } catch (error) {
      logger.error('Build failed', {
        projectId,
        correlationId,
        error: error.message,
        stack: error.stack,
      });

      // Mark project as errored
      await db('projects')
        .where('id', projectId)
        .update({
          status: 'error',
          error_message: error.message,
          updated_at: db.fn.now(),
        })
        .catch((dbErr) =>
          logger.error('Failed to update project error status', {
            projectId,
            error: dbErr.message,
          })
        );

      await progressEmitter.emit(projectId, {
        progress: -1,
        stage: 'error',
        message: `Build failed: ${error.message}`,
      });

      throw error;
    }
  }

  /**
   * Iterate on an existing project from a follow-up user message. Called by
   * buildWorker when the project already has files.
   *
   * @param {Object} options
   * @param {string} options.projectId
   * @param {string} options.conversationId
   * @param {string} options.messageId
   * @param {string} options.userId
   * @param {string} [options.correlationId]
   * @returns {Promise<{success: boolean, filesChanged: number, summary: string}>}
   */
  async iterateFromMessage(options) {
    const { projectId, conversationId, messageId, userId, correlationId } = options;

    logger.info('Starting iteration from message', {
      projectId,
      conversationId,
      messageId,
      correlationId,
    });

    const trackerOptions = { projectId, userId, correlationId };

    try {
      // ---------------------------------------------------------------
      // Stage 1: Load Context (0-10%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 2,
        stage: 'loading',
        message: 'Loading project context...',
      });

      const userMessage = await this._getUserMessage(messageId);
      const contextMd = await contextService.getContext(projectId) || '';
      const currentFiles = await this._getProjectFiles(projectId);
      const settings = await this._getProjectSettings(projectId);
      const requirements = settings.requirements || {};

      await db('projects')
        .where('id', projectId)
        .update({
          status: 'building',
          build_started_at: db.fn.now(),
          updated_at: db.fn.now(),
        });

      await progressEmitter.emit(projectId, {
        progress: 10,
        stage: 'loading',
        message: 'Context loaded',
      });

      // ---------------------------------------------------------------
      // Stage 2: Generate Changes (10-60%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 12,
        stage: 'iterating',
        message: 'Generating code changes...',
      });

      const { files: changedFiles, summary, envVarsNeeded } =
        await codeGeneratorService.iterateCode(
          userMessage,
          currentFiles,
          requirements,
          contextMd,
          trackerOptions
        );

      await progressEmitter.emit(projectId, {
        progress: 60,
        stage: 'iterating',
        message: `Generated ${changedFiles.length} file changes`,
      });

      // ---------------------------------------------------------------
      // Stage 3: Apply Changes (60-80%)
      // ---------------------------------------------------------------
      const totalChanges = changedFiles.length;
      let appliedCount = 0;

      for (let i = 0; i < changedFiles.length; i++) {
        const file = changedFiles[i];
        const progressPct = 60 + Math.round(((i + 1) / totalChanges) * 20);

        await progressEmitter.emit(projectId, {
          progress: Math.min(progressPct, 80),
          stage: 'applying',
          message: `Applying changes to ${file.path}...`,
        });

        if (file.action === 'delete') {
          await db('project_files')
            .where({ project_id: projectId, file_path: file.path })
            .delete();

          logger.info('File deleted', { projectId, filePath: file.path });
        } else {
          // action is 'create' or 'modify' -- upsert
          await this._saveFile(projectId, file);
        }

        appliedCount++;
      }

      // Handle new env vars if needed -- update the .env.example
      if (envVarsNeeded && envVarsNeeded.length > 0) {
        await this._appendEnvVars(projectId, envVarsNeeded, trackerOptions);
      }

      await progressEmitter.emit(projectId, {
        progress: 80,
        stage: 'applying',
        message: `Applied ${appliedCount} file changes`,
      });

      // ---------------------------------------------------------------
      // Stage 4: Create Version (80-90%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 82,
        stage: 'versioning',
        message: 'Creating version snapshot...',
      });

      const allFiles = await this._getProjectFiles(projectId);
      const versionNumber = await this._getNextVersionNumber(projectId);

      const snapshot = allFiles.map((f) => ({
        path: f.path,
        checksum: generateContentHash(f.content),
        language: f.language,
      }));

      await db('project_versions').insert({
        project_id: projectId,
        version_number: versionNumber,
        snapshot: JSON.stringify(snapshot),
        prompt_summary: userMessage,
        diff_summary: summary,
      });

      await progressEmitter.emit(projectId, {
        progress: 90,
        stage: 'versioning',
        message: `Version ${versionNumber} created`,
      });

      // ---------------------------------------------------------------
      // Stage 5: Update Context (90-95%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 91,
        stage: 'context',
        message: 'Updating project context...',
      });

      try {
        await contextService.buildContextFromHistory(projectId);
      } catch (contextError) {
        logger.warn('Failed to update context after iteration', {
          projectId,
          error: contextError.message,
        });
      }

      await progressEmitter.emit(projectId, {
        progress: 95,
        stage: 'context',
        message: 'Project context updated',
      });

      // ---------------------------------------------------------------
      // Stage 6: Finalize (95-100%)
      // ---------------------------------------------------------------
      await db('projects')
        .where('id', projectId)
        .update({
          status: 'draft',
          build_progress: 100,
          current_build_stage: 'complete',
          updated_at: db.fn.now(),
        });

      // Update requirements in settings if env vars were added
      if (envVarsNeeded && envVarsNeeded.length > 0) {
        const updatedSettings = await this._getProjectSettings(projectId);
        const existingEnvVars = updatedSettings.requirements?.envVarsNeeded || [];
        const mergedEnvVars = [
          ...new Set([...existingEnvVars, ...envVarsNeeded]),
        ];
        if (updatedSettings.requirements) {
          updatedSettings.requirements.envVarsNeeded = mergedEnvVars;
          await db('projects')
            .where('id', projectId)
            .update({
              settings: JSON.stringify(updatedSettings),
              updated_at: db.fn.now(),
            });
        }
      }

      const iterationMessage = `I've updated your app. Here's what changed:\n\n${summary}\n\n` +
        `${appliedCount} file(s) were modified.`;
      await this._storeAssistantMessage(conversationId, iterationMessage, {
        type: 'iteration-complete',
        filesChanged: appliedCount,
        versionNumber,
        summary,
      });

      await progressEmitter.emit(projectId, {
        progress: 100,
        stage: 'complete',
        message: 'Build complete!',
      });

      logger.info('Iteration completed successfully', {
        projectId,
        correlationId,
        filesChanged: appliedCount,
        versionNumber,
      });

      return {
        success: true,
        filesChanged: appliedCount,
        summary,
      };
    } catch (error) {
      logger.error('Iteration failed', {
        projectId,
        correlationId,
        error: error.message,
        stack: error.stack,
      });

      await db('projects')
        .where('id', projectId)
        .update({
          status: 'error',
          error_message: error.message,
          updated_at: db.fn.now(),
        })
        .catch((dbErr) =>
          logger.error('Failed to update project error status', {
            projectId,
            error: dbErr.message,
          })
        );

      await progressEmitter.emit(projectId, {
        progress: -1,
        stage: 'error',
        message: `Iteration failed: ${error.message}`,
      });

      throw error;
    }
  }

  /**
   * Check whether this is the first build for a project (no files exist yet).
   *
   * @param {string} projectId
   * @returns {Promise<boolean>}
   */
  async isFirstBuild(projectId) {
    const result = await db('project_files')
      .where('project_id', projectId)
      .count('id as count')
      .first();

    return parseInt(result.count, 10) === 0;
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Retrieve the user's message content from the messages table.
   * @private
   */
  async _getUserMessage(messageId) {
    const message = await db('messages')
      .where('id', messageId)
      .select('content')
      .first();

    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    return message.content;
  }

  /**
   * Get all project files as an array of { path, content, language }.
   * @private
   */
  async _getProjectFiles(projectId) {
    const rows = await db('project_files')
      .where('project_id', projectId)
      .select('file_path', 'content', 'language')
      .orderBy('file_path', 'asc');

    return rows.map((r) => ({
      path: r.file_path,
      content: r.content,
      language: r.language,
    }));
  }

  /**
   * Upsert a file into project_files. If a file with the same project_id and
   * file_path already exists, update it; otherwise insert a new row.
   * @private
   */
  async _saveFile(projectId, file) {
    const checksum = generateContentHash(file.content);
    const fileSize = Buffer.byteLength(file.content, 'utf8');

    const existing = await db('project_files')
      .where({ project_id: projectId, file_path: file.path })
      .select('id')
      .first();

    if (existing) {
      await db('project_files')
        .where('id', existing.id)
        .update({
          content: file.content,
          language: file.language || null,
          file_size: fileSize,
          checksum,
          updated_at: db.fn.now(),
        });
    } else {
      await db('project_files').insert({
        project_id: projectId,
        file_path: file.path,
        content: file.content,
        language: file.language || null,
        file_size: fileSize,
        checksum,
      });
    }

    logger.debug('File saved', {
      projectId,
      filePath: file.path,
      fileSize,
      checksum: checksum.substring(0, 12),
    });
  }

  /**
   * Insert an assistant message into the messages table.
   * @private
   */
  async _storeAssistantMessage(conversationId, content, metadata = {}) {
    await db('messages').insert({
      conversation_id: conversationId,
      role: 'assistant',
      content,
      metadata: JSON.stringify(metadata),
    });

    // Increment message count on the conversation
    await db('conversations')
      .where('id', conversationId)
      .increment('message_count', 1);
  }

  /**
   * Get the parsed settings JSON from the project record.
   * @private
   */
  async _getProjectSettings(projectId) {
    const project = await db('projects')
      .where('id', projectId)
      .select('settings')
      .first();

    if (!project) return {};

    if (typeof project.settings === 'string') {
      try {
        return JSON.parse(project.settings);
      } catch {
        return {};
      }
    }

    return project.settings || {};
  }

  /**
   * Determine the next version number for a project.
   * @private
   */
  async _getNextVersionNumber(projectId) {
    const latest = await db('project_versions')
      .where('project_id', projectId)
      .max('version_number as max_version')
      .first();

    return (latest?.max_version || 0) + 1;
  }

  /**
   * Build a human-readable summary of the analyzed requirements.
   * @private
   */
  _buildRequirementsSummary(requirements) {
    const parts = [`I'll build a **${requirements.appName || 'new app'}** for you.`];

    if (requirements.framework) {
      parts.push(`\n\n**Framework:** ${requirements.framework}`);
    }

    if (requirements.description) {
      parts.push(`\n\n**What it does:** ${requirements.description}`);
    }

    if (requirements.pages && requirements.pages.length > 0) {
      const pageList = requirements.pages
        .map((p) => `- ${typeof p === 'string' ? p : p.name || p.path}`)
        .join('\n');
      parts.push(`\n\n**Pages:**\n${pageList}`);
    }

    if (requirements.features && requirements.features.length > 0) {
      const featureList = requirements.features.map((f) => `- ${f}`).join('\n');
      parts.push(`\n\n**Features:**\n${featureList}`);
    }

    parts.push('\n\nLet me start building this for you...');

    return parts.join('');
  }

  /**
   * Build a completion message summarizing the finished build.
   * @private
   */
  _buildCompletionMessage(requirements, filesCreated) {
    const appName = requirements.appName || 'Your app';
    return (
      `${appName} is ready! Here's what I built:\n\n` +
      `- **Framework:** ${requirements.framework || 'React'}\n` +
      `- **Files created:** ${filesCreated}\n` +
      (requirements.pages
        ? `- **Pages:** ${requirements.pages.length}\n`
        : '') +
      (requirements.features
        ? `- **Features:** ${requirements.features.join(', ')}\n`
        : '') +
      `\nYou can preview the app or ask me to make changes.`
    );
  }

  /**
   * Build a file generation plan from requirements. Determines which files
   * need to be generated individually in Stage 3 (core code).
   * @private
   */
  _buildFilePlan(requirements) {
    const plan = [];
    const framework = (requirements.framework || 'react').toLowerCase();

    if (framework === 'react' || framework === 'react + vite' || framework === 'vite') {
      // Core entry files
      plan.push(
        { path: 'src/main.jsx', description: 'Application entry point', language: 'jsx' },
        { path: 'src/App.jsx', description: 'Root App component with routing', language: 'jsx' },
        { path: 'src/index.css', description: 'Global styles', language: 'css' }
      );

      // Pages from requirements
      if (requirements.pages && requirements.pages.length > 0) {
        for (const page of requirements.pages) {
          const pageName = typeof page === 'string' ? page : page.name || page.path;
          const sanitized = pageName.replace(/[^a-zA-Z0-9]/g, '');
          const componentName = sanitized.charAt(0).toUpperCase() + sanitized.slice(1);
          plan.push({
            path: `src/pages/${componentName}.jsx`,
            description: `${pageName} page component`,
            language: 'jsx',
          });
        }
      }

      // Shared components
      if (requirements.components && requirements.components.length > 0) {
        for (const comp of requirements.components) {
          const compName = typeof comp === 'string' ? comp : comp.name;
          const sanitized = compName.replace(/[^a-zA-Z0-9]/g, '');
          const componentName = sanitized.charAt(0).toUpperCase() + sanitized.slice(1);
          plan.push({
            path: `src/components/${componentName}.jsx`,
            description: `${compName} shared component`,
            language: 'jsx',
          });
        }
      }

      // API service if data model exists
      if (requirements.dataModel || requirements.api || requirements.endpoints) {
        plan.push({
          path: 'src/services/api.js',
          description: 'API service layer for data fetching',
          language: 'javascript',
        });
      }

      // Auth provider if auth feature is requested
      const features = (requirements.features || []).map((f) =>
        typeof f === 'string' ? f.toLowerCase() : ''
      );
      if (features.some((f) => f.includes('auth'))) {
        plan.push({
          path: 'src/components/AuthProvider.jsx',
          description: 'Authentication context provider',
          language: 'jsx',
        });
      }
    } else {
      // Generic fallback for non-React frameworks
      // Generate files based on pages and components listed in requirements
      if (requirements.pages) {
        for (const page of requirements.pages) {
          const pageName = typeof page === 'string' ? page : page.name || page.path;
          plan.push({
            path: `src/pages/${pageName}`,
            description: `${pageName} page`,
          });
        }
      }
    }

    return plan;
  }

  /**
   * Build config file specifications for batch generation in Stage 4.
   * @private
   */
  _buildConfigFileSpecs(requirements) {
    const specs = [];

    // .env.example with required env vars
    const envVars = requirements.envVarsNeeded || requirements.envVars || [];
    specs.push({
      path: '.env.example',
      description: `Environment variables template. Required vars: ${envVars.join(', ') || 'none'}`,
      language: 'dotenv',
    });

    // README.md
    specs.push({
      path: 'README.md',
      description: `Project README for ${requirements.appName || 'the application'}. ` +
        `Description: ${requirements.description || 'A web application'}`,
      language: 'markdown',
    });

    return specs;
  }

  /**
   * Append newly discovered env vars to the .env.example file.
   * @private
   */
  async _appendEnvVars(projectId, envVarsNeeded) {
    const existing = await db('project_files')
      .where({ project_id: projectId, file_path: '.env.example' })
      .select('content')
      .first();

    if (!existing) return;

    const existingContent = existing.content || '';
    const existingVarNames = existingContent
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => line.split('=')[0].trim());

    const newVars = envVarsNeeded.filter((v) => !existingVarNames.includes(v));

    if (newVars.length === 0) return;

    const additions = newVars.map((v) => `${v}=`).join('\n');
    const updatedContent = existingContent.trimEnd() + '\n\n# Added during iteration\n' + additions + '\n';

    await this._saveFile(projectId, {
      path: '.env.example',
      content: updatedContent,
      language: 'dotenv',
    });
  }
}

// Singleton instance
const appBuilderService = new AppBuilderService();

module.exports = appBuilderService;
