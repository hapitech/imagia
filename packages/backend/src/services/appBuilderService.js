const { db } = require('../config/database');
const logger = require('../config/logger');
const codeGeneratorService = require('./codeGeneratorService');
const codeValidatorService = require('./codeValidatorService');
const contextService = require('./contextService');
const { buildEnrichedMessage } = require('./urlExtractor');
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
    const { projectId, conversationId, messageId, userId, correlationId, model } = options;

    logger.info('Starting build from message', {
      projectId,
      conversationId,
      messageId,
      correlationId,
      model,
    });

    const trackerOptions = { projectId, userId, correlationId, model };

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
   * Uses a tool-calling agent (single LLM session) as the primary approach,
   * with fallback to the monolithic single-call method.
   *
   * 4 stages: Load Context → Tool-Calling Agent → Persist Changes → Finalize
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
    const { projectId, conversationId, messageId, userId, correlationId, model } = options;

    logger.info('Starting iteration from message (tool-calling agent)', {
      projectId,
      conversationId,
      messageId,
      correlationId,
      model,
    });

    const trackerOptions = { projectId, userId, correlationId, model };

    try {
      // ---------------------------------------------------------------
      // Stage 1: Load Context (0-5%)
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
        progress: 5,
        stage: 'loading',
        message: `Loaded ${currentFiles.length} project files`,
      });

      // ---------------------------------------------------------------
      // Stage 2: Tool-Calling Agent (5-85%)
      // ---------------------------------------------------------------
      let changedFiles, summary, envVarsNeeded, pipeline, agentResponse;

      if (this._supportsToolCalling(model)) {
        try {
          await progressEmitter.emit(projectId, {
            progress: 8,
            stage: 'iterating',
            message: 'Starting AI agent...',
          });

          const agentResult = await codeGeneratorService.iterateWithTools(
            userMessage,
            currentFiles,
            contextMd,
            trackerOptions,
            // Progress callback
            ({ type, detail }) => {
              const progress = type === 'read_files' ? 20 : 50;
              progressEmitter.emit(projectId, {
                progress: Math.min(progress, 80),
                stage: 'iterating',
                message: detail,
              }).catch(() => {}); // fire-and-forget
            }
          );

          changedFiles = agentResult.changedFiles;
          summary = agentResult.summary;
          envVarsNeeded = agentResult.envVarsNeeded;
          pipeline = 'tool-calling';
          // Capture the agent's text response for question/research/summary prompts
          agentResponse = agentResult.agentResponse || '';

          logger.info('Tool-calling agent succeeded', {
            projectId,
            correlationId,
            changedFiles: changedFiles.length,
            turnCount: agentResult.turnCount,
            totalTokens: agentResult.tokenUsage?.totalTokens,
          });
        } catch (toolError) {
          logger.warn('Tool-calling agent failed, falling back to monolithic iteration', {
            projectId,
            correlationId,
            error: toolError.message,
          });

          // Fall back to monolithic approach
          return this._monolithicIterate(
            projectId, conversationId, userMessage, currentFiles,
            requirements, contextMd, trackerOptions
          );
        }
      } else {
        // Model doesn't support tool calling, use monolithic
        logger.info('Model does not support tool calling, using monolithic iteration', {
          projectId,
          model,
        });
        return this._monolithicIterate(
          projectId, conversationId, userMessage, currentFiles,
          requirements, contextMd, trackerOptions
        );
      }

      // If no files were changed, use the agent's text response
      if (!changedFiles || changedFiles.length === 0) {
        const responseText = agentResponse || summary || 'I reviewed your project. Let me know if you need anything else.';

        await db('projects')
          .where('id', projectId)
          .update({
            status: 'draft',
            build_progress: 100,
            current_build_stage: 'complete',
            updated_at: db.fn.now(),
          });

        await this._storeAssistantMessage(conversationId, responseText, {
            type: 'iteration-complete',
            filesChanged: 0,
            pipeline,
          });

        await progressEmitter.emit(projectId, {
          progress: 100,
          stage: 'complete',
          message: 'Complete',
        });

        return { success: true, filesChanged: 0, summary: responseText };
      }

      await progressEmitter.emit(projectId, {
        progress: 85,
        stage: 'iterating',
        message: `Agent completed: ${changedFiles.length} file(s) changed`,
      });

      // ---------------------------------------------------------------
      // Stage 3: Persist Changes to DB (85-90%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 86,
        stage: 'applying',
        message: 'Saving changes...',
      });

      let appliedCount = 0;
      for (const file of changedFiles) {
        if (file.action === 'delete') {
          await db('project_files')
            .where({ project_id: projectId, file_path: file.path })
            .delete();
          logger.info('File deleted', { projectId, filePath: file.path });
        } else {
          await this._saveFile(projectId, file);
        }
        appliedCount++;
      }

      if (envVarsNeeded && envVarsNeeded.length > 0) {
        await this._appendEnvVars(projectId, envVarsNeeded, trackerOptions);
      }

      await progressEmitter.emit(projectId, {
        progress: 90,
        stage: 'applying',
        message: `Saved ${appliedCount} file changes`,
      });

      // ---------------------------------------------------------------
      // Stage 4: Version Snapshot + Context Update + Finalize (90-100%)
      // ---------------------------------------------------------------
      await progressEmitter.emit(projectId, {
        progress: 91,
        stage: 'finalizing',
        message: 'Creating version snapshot...',
      });

      const allFilesAfterApply = await this._getProjectFiles(projectId);
      const versionNumber = await this._getNextVersionNumber(projectId);
      const snapshot = allFilesAfterApply.map((f) => ({
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

      // Update context (non-critical)
      try {
        await contextService.buildContextFromHistory(projectId);
      } catch (contextError) {
        logger.warn('Failed to update context after iteration', {
          projectId,
          error: contextError.message,
        });
      }

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
        const mergedEnvVars = [...new Set([...existingEnvVars, ...envVarsNeeded])];
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

      let iterationMessage = `I've updated your app. Here's what changed:\n\n${summary}\n\n` +
        `${appliedCount} file(s) were modified.`;

      await this._storeAssistantMessage(conversationId, iterationMessage, {
        type: 'iteration-complete',
        filesChanged: appliedCount,
        versionNumber,
        summary,
        pipeline,
      });

      await progressEmitter.emit(projectId, {
        progress: 100,
        stage: 'complete',
        message: 'Build complete!',
      });

      logger.info('Tool-calling iteration completed successfully', {
        projectId,
        correlationId,
        filesChanged: appliedCount,
        versionNumber,
        pipeline,
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
  // Tool-calling helpers
  // ===========================================================================

  /**
   * Check whether the given model supports tool calling.
   * Models that support it: Kimi K2.5, GPT-4o, Claude Sonnet, Llama 3.3, Qwen3 Coder.
   * Models that don't: FLUX.1 (image only), very small models.
   * @private
   */
  _supportsToolCalling(model) {
    // If no model specified or 'auto', default to tool calling (Kimi K2.5 supports it)
    if (!model || model === 'auto') return true;

    const noToolModels = [
      'accounts/fireworks/models/flux-1-dev',
      'accounts/fireworks/models/qwen3-8b', // Too small for reliable tool use
    ];

    if (noToolModels.includes(model)) return false;

    // All major code/chat models support tool calling
    return true;
  }

  /**
   * Fallback: monolithic iteration using the original single-call approach.
   * Used when tool-calling fails or when the model doesn't support it.
   * @private
   */
  async _monolithicIterate(projectId, conversationId, userMessage, currentFiles, requirements, contextMd, trackerOptions) {
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

    // Apply changes
    let appliedCount = 0;
    for (let i = 0; i < changedFiles.length; i++) {
      const file = changedFiles[i];
      const progressPct = 60 + Math.round(((i + 1) / changedFiles.length) * 20);

      await progressEmitter.emit(projectId, {
        progress: Math.min(progressPct, 80),
        stage: 'applying',
        message: `Applying changes to ${file.path}...`,
      });

      if (file.action === 'delete') {
        await db('project_files')
          .where({ project_id: projectId, file_path: file.path })
          .delete();
      } else {
        await this._saveFile(projectId, file);
      }
      appliedCount++;
    }

    if (envVarsNeeded && envVarsNeeded.length > 0) {
      await this._appendEnvVars(projectId, envVarsNeeded, trackerOptions);
    }

    // Validate + auto-fix even in monolithic mode
    await progressEmitter.emit(projectId, {
      progress: 80,
      stage: 'validating',
      message: 'Validating generated code...',
    });

    let allFiles = await this._getProjectFiles(projectId);
    const validation = codeValidatorService.validateChanges(changedFiles, allFiles);

    let fixSummary = '';
    if (!validation.valid) {
      await progressEmitter.emit(projectId, {
        progress: 82,
        stage: 'fixing',
        message: `Found ${validation.errors.length} issue(s), auto-fixing...`,
      });

      const fixResult = await this._autoFixLoop(projectId, validation, allFiles, trackerOptions);
      fixSummary = fixResult.summary;
      appliedCount += fixResult.fixedCount;
      allFiles = await this._getProjectFiles(projectId);
    }

    // Version snapshot
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

    // Context update (non-critical)
    try {
      await contextService.buildContextFromHistory(projectId);
    } catch (contextError) {
      logger.warn('Failed to update context after iteration', {
        projectId,
        error: contextError.message,
      });
    }

    // Finalize
    await db('projects')
      .where('id', projectId)
      .update({
        status: 'draft',
        build_progress: 100,
        current_build_stage: 'complete',
        updated_at: db.fn.now(),
      });

    if (envVarsNeeded && envVarsNeeded.length > 0) {
      const updatedSettings = await this._getProjectSettings(projectId);
      const existingEnvVars = updatedSettings.requirements?.envVarsNeeded || [];
      const mergedEnvVars = [...new Set([...existingEnvVars, ...envVarsNeeded])];
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

    let iterationMessage = `I've updated your app. Here's what changed:\n\n${summary}\n\n` +
      `${appliedCount} file(s) were modified.`;
    if (fixSummary) {
      iterationMessage += `\n\n*Auto-fix applied:* ${fixSummary}`;
    }

    await this._storeAssistantMessage(conversationId, iterationMessage, {
      type: 'iteration-complete',
      filesChanged: appliedCount,
      versionNumber,
      summary,
      pipeline: 'monolithic',
    });

    await progressEmitter.emit(projectId, {
      progress: 100,
      stage: 'complete',
      message: 'Build complete!',
    });

    logger.info('Monolithic iteration completed successfully', {
      projectId,
      filesChanged: appliedCount,
      versionNumber,
    });

    return { success: true, filesChanged: appliedCount, summary };
  }

  /**
   * Auto-fix loop: repeatedly validate and fix errors up to maxIterations.
   * @private
   * @param {string} projectId
   * @param {{errors: Array}} validation - Initial validation result
   * @param {Array} allFiles - All project files after initial apply
   * @param {Object} trackerOptions
   * @param {number} [maxIterations=3]
   * @returns {Promise<{fixedCount: number, summary: string}>}
   */
  async _autoFixLoop(projectId, validation, allFiles, trackerOptions, maxIterations = 3) {
    let currentErrors = validation.errors;
    let totalFixedCount = 0;
    let combinedSummary = '';

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (currentErrors.length === 0) break;

      const iterProgress = 75 + Math.round(((iteration + 1) / maxIterations) * 15);

      await progressEmitter.emit(projectId, {
        progress: Math.min(iterProgress, 90),
        stage: 'fixing',
        message: `Auto-fix attempt ${iteration + 1}/${maxIterations} (${currentErrors.length} error${currentErrors.length > 1 ? 's' : ''})...`,
      });

      logger.info('Auto-fix iteration', {
        projectId,
        iteration: iteration + 1,
        errorCount: currentErrors.length,
        errors: currentErrors.map((e) => `${e.file}: ${e.message}`).slice(0, 5),
      });

      // Gather files that have errors
      const errorFilePaths = new Set(currentErrors.map((e) => e.file));
      const affectedFiles = allFiles.filter((f) => errorFilePaths.has(f.path));

      try {
        const fixResult = await codeGeneratorService.fixCodeErrors(
          currentErrors,
          affectedFiles,
          allFiles,
          trackerOptions
        );

        // Apply fixes
        for (const file of fixResult.files) {
          await this._saveFile(projectId, file);
          totalFixedCount++;
        }

        if (fixResult.summary) {
          combinedSummary += (combinedSummary ? '; ' : '') + fixResult.summary;
        }

        // Re-validate
        allFiles = await this._getProjectFiles(projectId);
        const revalidation = codeValidatorService.validateChanges(fixResult.files, allFiles);

        if (revalidation.valid) {
          logger.info('Auto-fix resolved all errors', {
            projectId,
            iteration: iteration + 1,
            totalFixed: totalFixedCount,
          });
          currentErrors = [];
          break;
        }

        currentErrors = revalidation.errors;

        // If remaining issues reported by the LLM and they match remaining errors, stop
        if (fixResult.remainingIssues && fixResult.remainingIssues.length > 0) {
          logger.info('LLM reported remaining issues, continuing fix loop', {
            projectId,
            remainingIssues: fixResult.remainingIssues.length,
          });
        }
      } catch (fixError) {
        logger.warn('Auto-fix iteration failed', {
          projectId,
          iteration: iteration + 1,
          error: fixError.message,
        });
        // Stop the fix loop on error — the code will proceed with remaining validation errors
        break;
      }
    }

    if (currentErrors.length > 0) {
      logger.warn('Auto-fix did not resolve all errors', {
        projectId,
        remainingErrors: currentErrors.length,
        errors: currentErrors.map((e) => `${e.file}: ${e.message}`),
      });
    }

    return {
      fixedCount: totalFixedCount,
      summary: combinedSummary,
    };
  }

  // ===========================================================================
  // Private helpers
  // ===========================================================================

  /**
   * Retrieve the user's message content from the messages table.
   * If the message has URL extractions stored in metadata, enrich
   * the content with the extracted webpage text so the LLM can reference it.
   * @private
   */
  async _getUserMessage(messageId) {
    const message = await db('messages')
      .where('id', messageId)
      .select('content', 'metadata')
      .first();

    if (!message) {
      throw new Error(`Message ${messageId} not found`);
    }

    // Parse metadata and check for URL extractions
    let metadata = message.metadata;
    if (typeof metadata === 'string') {
      try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
    }
    metadata = metadata || {};

    if (metadata.url_extractions && metadata.url_extractions.length > 0) {
      logger.info('Enriching message with URL extractions', {
        messageId,
        urlCount: metadata.url_extractions.length,
      });
      return buildEnrichedMessage(message.content, metadata.url_extractions);
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
