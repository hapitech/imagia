const acorn = require('acorn');
const acornJsx = require('acorn-jsx');
const logger = require('../config/logger');

const jsxParser = acorn.Parser.extend(acornJsx());

/**
 * File extensions that should be parsed as JavaScript/JSX.
 */
const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

/**
 * File extensions that are valid import targets (resolve candidates).
 */
const RESOLVABLE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '/index.js', '/index.jsx', '/index.ts', '/index.tsx'];

class CodeValidatorService {
  /**
   * Validate an array of changed files against the full project file set.
   *
   * @param {Array<{path: string, content: string, action?: string}>} changedFiles
   * @param {Array<{path: string, content: string}>} allProjectFiles
   * @returns {{valid: boolean, errors: Array<{file: string, line?: number, message: string, type: string}>, warnings: Array}}
   */
  validateChanges(changedFiles, allProjectFiles) {
    const errors = [];
    const warnings = [];

    // Build a set of all project file paths for import resolution
    const projectPaths = new Set(allProjectFiles.map((f) => f.path));

    // Also add paths from changedFiles that are creates/modifies (they'll exist after apply)
    for (const f of changedFiles) {
      if (f.action !== 'delete') {
        projectPaths.add(f.path);
      }
    }

    // Remove deleted files from the project path set
    for (const f of changedFiles) {
      if (f.action === 'delete') {
        projectPaths.delete(f.path);
      }
    }

    for (const file of changedFiles) {
      if (file.action === 'delete') continue;
      if (!file.content) continue;

      const ext = this._getExtension(file.path);

      // JSON validation
      if (ext === '.json') {
        const jsonErrors = this._validateJson(file.path, file.content);
        errors.push(...jsonErrors);
        continue;
      }

      // JS/JSX syntax validation
      if (JS_EXTENSIONS.has(ext)) {
        const syntaxErrors = this._validateSyntax(file.path, file.content);
        errors.push(...syntaxErrors);

        // Only check imports if syntax is valid
        if (syntaxErrors.length === 0) {
          const importErrors = this._validateImports(file.path, file.content, projectPaths);
          errors.push(...importErrors);
        }
      }
    }

    // Check for imports pointing to deleted files
    const deletedImportErrors = this._checkDeletedImports(changedFiles, allProjectFiles, projectPaths);
    errors.push(...deletedImportErrors);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Parse JS/JSX content with acorn to detect syntax errors.
   * @private
   */
  _validateSyntax(filePath, content) {
    const errors = [];

    try {
      jsxParser.parse(content, {
        ecmaVersion: 'latest',
        sourceType: 'module',
        locations: true,
      });
    } catch (parseError) {
      errors.push({
        file: filePath,
        line: parseError.loc?.line || null,
        column: parseError.loc?.column || null,
        message: parseError.message,
        type: 'syntax',
      });
    }

    return errors;
  }

  /**
   * Validate that relative imports resolve to existing project files.
   * @private
   */
  _validateImports(filePath, content, projectPaths) {
    const errors = [];
    const importPattern = /(?:import\s+[\s\S]*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

    let match;
    while ((match = importPattern.exec(content)) !== null) {
      const importPath = match[1] || match[2];

      // Only validate relative imports (starting with . or ..)
      if (!importPath.startsWith('.')) continue;

      // Skip CSS/asset imports
      if (/\.(css|scss|less|svg|png|jpg|jpeg|gif|woff2?|ttf|eot)$/.test(importPath)) continue;

      const resolved = this._resolveImport(filePath, importPath, projectPaths);
      if (!resolved) {
        // Find the line number of the import
        const lines = content.split('\n');
        let lineNum = null;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(importPath)) {
            lineNum = i + 1;
            break;
          }
        }

        errors.push({
          file: filePath,
          line: lineNum,
          message: `Unresolved import '${importPath}' — no matching file found in project`,
          type: 'import',
        });
      }
    }

    return errors;
  }

  /**
   * Validate JSON file content.
   * @private
   */
  _validateJson(filePath, content) {
    const errors = [];

    try {
      JSON.parse(content);
    } catch (parseError) {
      errors.push({
        file: filePath,
        line: null,
        message: `Invalid JSON: ${parseError.message}`,
        type: 'json',
      });
    }

    return errors;
  }

  /**
   * Detect existing files that import a file being deleted.
   * @private
   */
  _checkDeletedImports(changedFiles, allProjectFiles, projectPaths) {
    const errors = [];
    const deletedPaths = new Set(
      changedFiles.filter((f) => f.action === 'delete').map((f) => f.path)
    );

    if (deletedPaths.size === 0) return errors;

    // Build a map of the latest content for each file (changed files override originals)
    const changedMap = new Map(
      changedFiles.filter((f) => f.action !== 'delete').map((f) => [f.path, f.content])
    );

    // Check all non-deleted project files for imports to deleted files
    for (const file of allProjectFiles) {
      if (deletedPaths.has(file.path)) continue;

      const ext = this._getExtension(file.path);
      if (!JS_EXTENSIONS.has(ext)) continue;

      // Use updated content if the file was changed, otherwise original
      const content = changedMap.get(file.path) || file.content;
      if (!content) continue;

      const importPattern = /(?:import\s+[\s\S]*?from\s+['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\))/g;

      let match;
      while ((match = importPattern.exec(content)) !== null) {
        const importPath = match[1] || match[2];
        if (!importPath.startsWith('.')) continue;

        // Resolve the import and check if it points to a deleted file
        const resolved = this._resolveImportToPath(file.path, importPath);
        if (resolved && deletedPaths.has(resolved)) {
          errors.push({
            file: file.path,
            line: null,
            message: `Imports '${importPath}' which resolves to deleted file '${resolved}'`,
            type: 'deleted-import',
          });
        }
      }
    }

    return errors;
  }

  /**
   * Resolve a relative import path against the project file set.
   * Tries the raw path, then with common extensions appended.
   * @private
   * @returns {boolean} Whether the import resolves to an existing file
   */
  _resolveImport(fromFile, importPath, projectPaths) {
    const basePath = this._resolveRelativePath(fromFile, importPath);

    // Direct match
    if (projectPaths.has(basePath)) return true;

    // Try adding extensions
    for (const ext of RESOLVABLE_EXTENSIONS) {
      if (projectPaths.has(basePath + ext)) return true;
    }

    return false;
  }

  /**
   * Resolve a relative import to its most likely absolute project path.
   * Used for deleted-import checking where we need the actual path.
   * @private
   * @returns {string|null}
   */
  _resolveImportToPath(fromFile, importPath) {
    return this._resolveRelativePath(fromFile, importPath);
  }

  /**
   * Resolve a relative path from a source file.
   * e.g. from 'src/pages/Home.jsx', import './Header' → 'src/pages/Header'
   * @private
   */
  _resolveRelativePath(fromFile, relativePath) {
    const fromDir = fromFile.split('/').slice(0, -1).join('/');
    const parts = (fromDir ? fromDir + '/' + relativePath : relativePath).split('/');

    const resolved = [];
    for (const part of parts) {
      if (part === '.' || part === '') continue;
      if (part === '..') {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }

    return resolved.join('/');
  }

  /**
   * Get the file extension (lowercase, including the dot).
   * @private
   */
  _getExtension(filePath) {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot === -1) return '';
    return filePath.substring(lastDot).toLowerCase();
  }
}

const codeValidatorService = new CodeValidatorService();

module.exports = codeValidatorService;
