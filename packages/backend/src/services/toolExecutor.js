const codeValidatorService = require('./codeValidatorService');
const logger = require('../config/logger');

/**
 * In-memory tool execution engine for the tool-calling iteration agent.
 * Manages file state during a session and dispatches tool calls.
 */
class ToolExecutor {
  /**
   * @param {Array<{path: string, content: string, language?: string}>} projectFiles
   */
  constructor(projectFiles) {
    // In-memory file map: path → { content, language }
    this._files = new Map();
    for (const f of projectFiles) {
      this._files.set(f.path, { content: f.content, language: f.language || null });
    }

    // Track which files were changed during this session
    this._changedFiles = new Map();

    // Accumulated summary and env vars from apply_changes calls
    this._summaries = [];
    this._envVarsNeeded = new Set();
  }

  /**
   * Execute a tool call by name.
   * @param {string} toolName - 'read_files' or 'apply_changes'
   * @param {Object} args - Parsed arguments from the LLM
   * @returns {{result: string}} - Stringified result for the LLM
   */
  execute(toolName, args) {
    switch (toolName) {
      case 'read_files':
        return this._readFiles(args);
      case 'apply_changes':
        return this._applyChanges(args);
      default:
        return { result: JSON.stringify({ error: `Unknown tool: ${toolName}` }) };
    }
  }

  /**
   * Read file contents from in-memory state.
   * @private
   */
  _readFiles({ paths }) {
    if (!Array.isArray(paths) || paths.length === 0) {
      return { result: JSON.stringify({ error: 'paths must be a non-empty array' }) };
    }

    const results = {};
    for (const p of paths.slice(0, 10)) {
      const file = this._files.get(p);
      if (file) {
        results[p] = file.content;
      } else {
        results[p] = null; // file not found
      }
    }

    return { result: JSON.stringify(results) };
  }

  /**
   * Apply file changes and auto-validate.
   * @private
   */
  _applyChanges({ files, summary, envVarsNeeded }) {
    if (!Array.isArray(files) || files.length === 0) {
      return { result: JSON.stringify({ error: 'files must be a non-empty array' }) };
    }

    // Apply changes to in-memory state
    const applied = [];
    for (const f of files) {
      if (f.action === 'delete') {
        this._files.delete(f.path);
        this._changedFiles.set(f.path, { path: f.path, action: 'delete', content: '', language: null });
        applied.push({ path: f.path, action: 'delete' });
      } else {
        const language = f.language || this._inferLanguage(f.path);
        this._files.set(f.path, { content: f.content, language });
        this._changedFiles.set(f.path, { path: f.path, content: f.content, language, action: f.action || 'modify' });
        applied.push({ path: f.path, action: f.action || 'modify' });
      }
    }

    if (summary) {
      this._summaries.push(summary);
    }

    if (envVarsNeeded && Array.isArray(envVarsNeeded)) {
      for (const v of envVarsNeeded) {
        this._envVarsNeeded.add(v);
      }
    }

    // Validate the changed files against the full in-memory project
    const changedForValidation = files
      .filter((f) => f.action !== 'delete')
      .map((f) => ({
        path: f.path,
        content: f.content,
        action: f.action || 'modify',
      }));

    const allProjectFiles = Array.from(this._files.entries()).map(([path, data]) => ({
      path,
      content: data.content,
    }));

    let validation = { valid: true, errors: [], warnings: [] };
    if (changedForValidation.length > 0) {
      try {
        validation = codeValidatorService.validateChanges(changedForValidation, allProjectFiles);
      } catch (err) {
        logger.warn('Validation threw during tool execution', { error: err.message });
        validation = { valid: true, errors: [], warnings: [] };
      }
    }

    const result = {
      applied: applied.length,
      validation: {
        valid: validation.valid,
        errors: validation.errors.map((e) => ({
          file: e.file,
          line: e.line,
          message: e.message,
          type: e.type,
        })),
      },
    };

    logger.info('Tool apply_changes executed', {
      applied: applied.length,
      valid: validation.valid,
      errorCount: validation.errors.length,
    });

    return { result: JSON.stringify(result) };
  }

  /**
   * Get the final results after the session ends.
   * @returns {{changedFiles: Array, summary: string, envVarsNeeded: string[]}}
   */
  getResults() {
    const changedFiles = Array.from(this._changedFiles.values());
    const summary = this._summaries.join('; ');
    const envVarsNeeded = Array.from(this._envVarsNeeded);

    return { changedFiles, summary, envVarsNeeded };
  }

  /**
   * Get sorted file paths for the system prompt manifest.
   * @returns {string[]}
   */
  getFileManifest() {
    return Array.from(this._files.keys()).sort();
  }

  /**
   * Infer language from file extension.
   * @private
   */
  _inferLanguage(filePath) {
    if (!filePath) return 'text';
    const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
    const map = {
      '.js': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
      '.css': 'css', '.scss': 'scss', '.html': 'html', '.json': 'json',
      '.md': 'markdown', '.yaml': 'yaml', '.yml': 'yaml', '.svg': 'svg',
      '.env': 'dotenv',
    };
    return map[ext] || 'text';
  }
}

module.exports = ToolExecutor;
