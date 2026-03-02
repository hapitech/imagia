const logger = require('../config/logger');
const llmRouter = require('./llmRouter');
const promptTracker = require('./promptTracker');
const { buildRequirementsPrompt, buildScaffoldPrompt } = require('../utils/prompts/appScaffold');
const { buildFileGenerationPrompt, buildBatchFilePrompt } = require('../utils/prompts/codeGeneration');
const { buildIterationPrompt } = require('../utils/prompts/codeIteration');
const { buildChangeAnalysisPrompt, buildChangePlanPrompt } = require('../utils/prompts/changeAnalysis');
const { buildCodeFixPrompt } = require('../utils/prompts/codeFix');

/**
 * Extension-to-language mapping for file path inference.
 */
const EXTENSION_MAP = {
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.html': 'html',
  '.htm': 'html',
  '.json': 'json',
  '.md': 'markdown',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.svg': 'svg',
  '.py': 'python',
  '.rb': 'ruby',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.sh': 'shell',
  '.bash': 'shell',
  '.sql': 'sql',
  '.graphql': 'graphql',
  '.gql': 'graphql',
  '.env': 'dotenv',
  '.toml': 'toml',
  '.ini': 'ini',
  '.dockerfile': 'dockerfile',
  '.prisma': 'prisma',
};

class CodeGeneratorService {
  /**
   * Analyze user requirements by sending the user message and existing context
   * to an LLM. Returns a structured requirements object.
   *
   * @param {string} userMessage - The user's build request
   * @param {string} contextMd - Existing project context markdown (may be empty)
   * @param {Object} options
   * @param {string} options.projectId
   * @param {string} options.userId
   * @param {string} [options.correlationId]
   * @returns {Promise<Object>} Parsed requirements object from the LLM
   */
  async analyzeRequirements(userMessage, contextMd, options) {
    const { projectId, userId, correlationId, model } = options;

    logger.info('Analyzing requirements', { projectId, correlationId, model });

    const { systemMessage, prompt, maxTokens, temperature } =
      buildRequirementsPrompt(userMessage, contextMd);

    const result = await promptTracker.track({
      projectId,
      userId,
      taskType: 'code-generation',
      correlationId,
      prompt,
      systemMessage,
      callFn: () =>
        llmRouter.route('code-generation', {
          systemMessage,
          prompt,
          maxTokens: maxTokens || 4096,
          temperature: temperature ?? 0.4,
          responseFormat: 'json',
          modelOverride: model,
        }),
    });

    const requirements = this._parseJsonResponse(result.content);

    logger.info('Requirements analyzed', {
      projectId,
      correlationId,
      promptLogId: result.promptLogId,
      framework: requirements.framework,
      pageCount: requirements.pages?.length,
    });

    return requirements;
  }

  /**
   * Generate a project scaffold (boilerplate files) based on analyzed requirements.
   *
   * @param {Object} requirements - The structured requirements object
   * @param {Object} options
   * @param {string} options.projectId
   * @param {string} options.userId
   * @param {string} [options.correlationId]
   * @returns {Promise<{files: Array<{path: string, content: string, language: string}>}>}
   */
  async generateScaffold(requirements, options) {
    const { projectId, userId, correlationId, model } = options;

    logger.info('Generating scaffold', { projectId, correlationId, model });

    const { systemMessage, prompt, maxTokens, temperature } =
      buildScaffoldPrompt(requirements);

    const result = await promptTracker.track({
      projectId,
      userId,
      taskType: 'scaffold',
      correlationId,
      prompt,
      systemMessage,
      callFn: () =>
        llmRouter.route('scaffold', {
          systemMessage,
          prompt,
          maxTokens: maxTokens || 4096,
          temperature: temperature ?? 0.3,
          responseFormat: 'json',
          modelOverride: model,
        }),
    });

    const parsed = this._parseJsonResponse(result.content);
    const files = (parsed.files || parsed).map((f) => ({
      path: f.path,
      content: f.content,
      language: f.language || this._inferLanguage(f.path),
    }));

    logger.info('Scaffold generated', {
      projectId,
      correlationId,
      promptLogId: result.promptLogId,
      fileCount: files.length,
    });

    return { files };
  }

  /**
   * Generate a single file given the project requirements, already-generated files,
   * a file specification, and the project context.
   *
   * @param {Object} requirements - The structured requirements object
   * @param {Array<{path: string, content: string}>} existingFiles - Files generated so far
   * @param {Object} fileSpec - { path, description, language }
   * @param {string} contextMd - Project context markdown
   * @param {Object} options
   * @param {string} options.projectId
   * @param {string} options.userId
   * @param {string} [options.correlationId]
   * @returns {Promise<{path: string, content: string, language: string}>}
   */
  async generateFile(requirements, existingFiles, fileSpec, contextMd, options) {
    const { projectId, userId, correlationId, model } = options;

    logger.info('Generating file', {
      projectId,
      correlationId,
      filePath: fileSpec.path,
      model,
    });

    const { systemMessage, prompt, maxTokens, temperature } =
      buildFileGenerationPrompt(requirements, existingFiles, fileSpec, contextMd);

    const result = await promptTracker.track({
      projectId,
      userId,
      taskType: 'code-generation',
      correlationId,
      prompt,
      systemMessage,
      callFn: () =>
        llmRouter.route('code-generation', {
          systemMessage,
          prompt,
          maxTokens: maxTokens || 8192,
          temperature: temperature ?? 0.3,
          modelOverride: model,
        }),
    });

    logger.info('File generated', {
      projectId,
      correlationId,
      promptLogId: result.promptLogId,
      filePath: fileSpec.path,
      contentLength: result.content.length,
    });

    return {
      path: fileSpec.path,
      content: result.content,
      language: fileSpec.language || this._inferLanguage(fileSpec.path),
    };
  }

  /**
   * Generate multiple files in a single LLM call. Useful for config files
   * and other small, related files.
   *
   * @param {Object} requirements - The structured requirements object
   * @param {Array<Object>} fileSpecs - Array of { path, description, language }
   * @param {string} contextMd - Project context markdown
   * @param {Object} options
   * @param {string} options.projectId
   * @param {string} options.userId
   * @param {string} [options.correlationId]
   * @returns {Promise<{files: Array<{path: string, content: string, language: string}>}>}
   */
  async generateBatchFiles(requirements, fileSpecs, contextMd, options) {
    const { projectId, userId, correlationId, model } = options;

    logger.info('Generating batch files', {
      projectId,
      correlationId,
      fileCount: fileSpecs.length,
      filePaths: fileSpecs.map((f) => f.path),
      model,
    });

    const { systemMessage, prompt, maxTokens, temperature } =
      buildBatchFilePrompt(requirements, fileSpecs, contextMd);

    const result = await promptTracker.track({
      projectId,
      userId,
      taskType: 'code-generation',
      correlationId,
      prompt,
      systemMessage,
      callFn: () =>
        llmRouter.route('code-generation', {
          systemMessage,
          prompt,
          maxTokens: maxTokens || 8192,
          temperature: temperature ?? 0.3,
          responseFormat: 'json',
          modelOverride: model,
        }),
    });

    const parsed = this._parseJsonResponse(result.content);
    const files = (parsed.files || parsed).map((f) => ({
      path: f.path,
      content: f.content,
      language: f.language || this._inferLanguage(f.path),
    }));

    logger.info('Batch files generated', {
      projectId,
      correlationId,
      promptLogId: result.promptLogId,
      fileCount: files.length,
    });

    return { files };
  }

  /**
   * Iterate on existing code based on a follow-up user message. Returns
   * modified/new files along with a summary and any new env vars needed.
   *
   * @param {string} userMessage - The user's follow-up request
   * @param {Array<{path: string, content: string}>} currentFiles - Current project files
   * @param {Object} requirements - The structured requirements object
   * @param {string} contextMd - Project context markdown
   * @param {Object} options
   * @param {string} options.projectId
   * @param {string} options.userId
   * @param {string} [options.correlationId]
   * @returns {Promise<{files: Array, summary: string, envVarsNeeded: Array}>}
   */
  async iterateCode(userMessage, currentFiles, requirements, contextMd, options) {
    const { projectId, userId, correlationId, model } = options;

    logger.info('Iterating code', {
      projectId,
      correlationId,
      currentFileCount: currentFiles.length,
      model,
    });

    const { systemMessage, prompt, maxTokens, temperature } =
      buildIterationPrompt(userMessage, currentFiles, requirements, contextMd);

    const result = await promptTracker.track({
      projectId,
      userId,
      taskType: 'code-iteration',
      correlationId,
      prompt,
      systemMessage,
      callFn: () =>
        llmRouter.route('code-iteration', {
          systemMessage,
          prompt,
          maxTokens: maxTokens || 8192,
          temperature: temperature ?? 0.3,
          responseFormat: 'json',
          modelOverride: model,
        }),
    });

    const parsed = this._parseJsonResponse(result.content);

    const files = (parsed.files || []).map((f) => ({
      path: f.path,
      content: f.content,
      language: f.language || this._inferLanguage(f.path),
      action: f.action || 'modify',
    }));

    const summary = parsed.summary || '';
    const envVarsNeeded = parsed.envVarsNeeded || [];

    logger.info('Code iteration complete', {
      projectId,
      correlationId,
      promptLogId: result.promptLogId,
      filesChanged: files.length,
      summaryLength: summary.length,
    });

    return { files, summary, envVarsNeeded };
  }

  /**
   * Analyze a change request to identify affected files (Stage 1 of multi-step pipeline).
   * Uses a fast/cheap model since it only receives file paths, not content.
   *
   * @param {string} userMessage - The user's change request
   * @param {Array<string>} fileManifest - Array of file paths in the project
   * @param {string} contextMd - Project context markdown
   * @param {Object} options
   * @returns {Promise<{changeType: string, summary: string, affectedFiles: Array, newFilesNeeded: Array, complexity: string}>}
   */
  async analyzeChange(userMessage, fileManifest, contextMd, options) {
    const { projectId, userId, correlationId } = options;

    logger.info('Analyzing change request', { projectId, correlationId, fileCount: fileManifest.length });

    const { systemMessage, prompt, maxTokens, temperature } =
      buildChangeAnalysisPrompt(userMessage, fileManifest, contextMd);

    const result = await promptTracker.track({
      projectId,
      userId,
      taskType: 'change-analysis',
      correlationId,
      prompt,
      systemMessage,
      callFn: () =>
        llmRouter.route('change-analysis', {
          systemMessage,
          prompt,
          maxTokens,
          temperature,
          responseFormat: 'json',
        }),
    });

    const analysis = this._parseJsonResponse(result.content);

    logger.info('Change analysis complete', {
      projectId,
      correlationId,
      promptLogId: result.promptLogId,
      changeType: analysis.changeType,
      affectedCount: analysis.affectedFiles?.length,
      newFilesCount: analysis.newFilesNeeded?.length,
      complexity: analysis.complexity,
    });

    return analysis;
  }

  /**
   * Plan changes based on analysis results (Stage 2 of multi-step pipeline).
   * Uses a fast/cheap model with the affected file content.
   *
   * @param {string} userMessage - The user's change request
   * @param {Object} analysis - Stage 1 analysis result
   * @param {Array<{path: string, content: string}>} affectedFiles - Full content of affected files
   * @param {string} contextMd - Project context markdown
   * @param {Object} options
   * @returns {Promise<{plan: Array, summary: string, generationGroups: Array}>}
   */
  async planChanges(userMessage, analysis, affectedFiles, contextMd, options) {
    const { projectId, userId, correlationId } = options;

    logger.info('Planning changes', { projectId, correlationId, affectedCount: affectedFiles.length });

    const { systemMessage, prompt, maxTokens, temperature } =
      buildChangePlanPrompt(userMessage, analysis, affectedFiles, contextMd);

    const result = await promptTracker.track({
      projectId,
      userId,
      taskType: 'change-planning',
      correlationId,
      prompt,
      systemMessage,
      callFn: () =>
        llmRouter.route('change-planning', {
          systemMessage,
          prompt,
          maxTokens,
          temperature,
          responseFormat: 'json',
        }),
    });

    const plan = this._parseJsonResponse(result.content);

    logger.info('Change plan complete', {
      projectId,
      correlationId,
      promptLogId: result.promptLogId,
      planSteps: plan.plan?.length,
      groupCount: plan.generationGroups?.length,
    });

    return plan;
  }

  /**
   * Fix validation errors in generated code (Stage 6 of multi-step pipeline).
   * Uses the code model for precise error correction.
   *
   * @param {Array<{file: string, line?: number, message: string, type: string}>} errors
   * @param {Array<{path: string, content: string}>} affectedFiles - Files that have errors
   * @param {Array<{path: string, content: string}>} allProjectFiles - All project files for reference
   * @param {Object} options
   * @returns {Promise<{files: Array, summary: string, remainingIssues: Array}>}
   */
  async fixCodeErrors(errors, affectedFiles, allProjectFiles, options) {
    const { projectId, userId, correlationId } = options;

    logger.info('Fixing code errors', {
      projectId,
      correlationId,
      errorCount: errors.length,
      affectedFileCount: affectedFiles.length,
    });

    // Context files = all project files minus the affected ones
    const affectedPaths = new Set(affectedFiles.map((f) => f.path));
    const contextFiles = allProjectFiles.filter((f) => !affectedPaths.has(f.path));
    const contextMd = ''; // Not needed for targeted fixes

    const { systemMessage, prompt, maxTokens, temperature } =
      buildCodeFixPrompt(errors, affectedFiles, contextFiles, contextMd);

    const result = await promptTracker.track({
      projectId,
      userId,
      taskType: 'code-fix',
      correlationId,
      prompt,
      systemMessage,
      callFn: () =>
        llmRouter.route('code-fix', {
          systemMessage,
          prompt,
          maxTokens,
          temperature,
          responseFormat: 'json',
        }),
    });

    const parsed = this._parseJsonResponse(result.content);

    const files = (parsed.files || []).map((f) => ({
      path: f.path,
      content: f.content,
      language: f.language || this._inferLanguage(f.path),
      action: f.action || 'modify',
    }));

    logger.info('Code fix complete', {
      projectId,
      correlationId,
      promptLogId: result.promptLogId,
      filesFixed: files.length,
      remainingIssues: parsed.remainingIssues?.length || 0,
    });

    return {
      files,
      summary: parsed.summary || '',
      remainingIssues: parsed.remainingIssues || [],
    };
  }

  /**
   * Parse a JSON response from an LLM, handling markdown code fences
   * and control character pollution.
   *
   * @param {string} content - Raw LLM response content
   * @returns {Object} Parsed JSON object
   * @throws {Error} If the content cannot be parsed as valid JSON
   * @private
   */
  _parseJsonResponse(content) {
    if (!content || typeof content !== 'string') {
      throw new Error('Empty or non-string LLM response cannot be parsed as JSON');
    }

    let cleaned = content.trim();

    // Strip markdown code fences: ```json ... ``` or ``` ... ```
    const fencePattern = /^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?\s*```$/;
    const fenceMatch = cleaned.match(fencePattern);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    }

    // If the content still starts/ends with fences (LLM sometimes nests them),
    // try stripping the outermost pair
    if (cleaned.startsWith('```')) {
      const firstNewline = cleaned.indexOf('\n');
      if (firstNewline !== -1) {
        cleaned = cleaned.substring(firstNewline + 1);
      }
      if (cleaned.endsWith('```')) {
        cleaned = cleaned.substring(0, cleaned.lastIndexOf('```'));
      }
      cleaned = cleaned.trim();
    }

    // Sanitize control characters that break JSON.parse (except \n, \r, \t)
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

    try {
      return JSON.parse(cleaned);
    } catch (parseError) {
      // Attempt a more aggressive extraction: find the first { or [ and last } or ]
      const firstBrace = cleaned.indexOf('{');
      const firstBracket = cleaned.indexOf('[');
      let startIdx = -1;
      let endChar = '';

      if (firstBrace === -1 && firstBracket === -1) {
        throw new Error(
          `Failed to parse LLM response as JSON: no object or array found. ` +
          `Parse error: ${parseError.message}. Content preview: ${content.substring(0, 200)}`
        );
      }

      if (firstBrace === -1) {
        startIdx = firstBracket;
        endChar = ']';
      } else if (firstBracket === -1) {
        startIdx = firstBrace;
        endChar = '}';
      } else {
        startIdx = Math.min(firstBrace, firstBracket);
        endChar = startIdx === firstBrace ? '}' : ']';
      }

      const endIdx = cleaned.lastIndexOf(endChar);
      if (endIdx <= startIdx) {
        throw new Error(
          `Failed to parse LLM response as JSON: unbalanced delimiters. ` +
          `Parse error: ${parseError.message}. Content preview: ${content.substring(0, 200)}`
        );
      }

      const extracted = cleaned.substring(startIdx, endIdx + 1);

      try {
        return JSON.parse(extracted);
      } catch (secondError) {
        throw new Error(
          `Failed to parse LLM response as JSON after extraction attempt. ` +
          `Original error: ${parseError.message}. ` +
          `Extraction error: ${secondError.message}. ` +
          `Content preview: ${content.substring(0, 200)}`
        );
      }
    }
  }

  /**
   * Infer the programming language from a file path extension.
   *
   * @param {string} filePath - The file path to infer from
   * @returns {string} The inferred language, or 'text' as a fallback
   * @private
   */
  _inferLanguage(filePath) {
    if (!filePath) return 'text';

    // Handle special filenames without extensions
    const basename = filePath.split('/').pop().toLowerCase();
    if (basename === 'dockerfile') return 'dockerfile';
    if (basename === 'makefile') return 'makefile';
    if (basename === '.gitignore') return 'gitignore';
    if (basename === '.env' || basename === '.env.example' || basename === '.env.local') {
      return 'dotenv';
    }

    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) return 'text';

    const ext = filePath.substring(lastDot).toLowerCase();
    return EXTENSION_MAP[ext] || 'text';
  }
}

// Singleton instance
const codeGeneratorService = new CodeGeneratorService();

module.exports = codeGeneratorService;
