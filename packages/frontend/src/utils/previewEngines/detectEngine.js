/**
 * Engine Detection
 *
 * Analyzes project metadata and file contents to determine
 * which preview engine to use: react, static, or express.
 * Also detects monorepo structures and returns a filePrefix
 * so engines can normalize paths.
 */

const REACT_TYPES = new Set([
  'react-spa', 'next-app', 'react', 'vite', 'react + vite', 'next', 'nextjs', 'next.js',
]);
const STATIC_TYPES = new Set(['static-site', 'static']);
const EXPRESS_TYPES = new Set(['express-api', 'express', 'node']);

/**
 * Detect monorepo frontend subdirectory.
 * Scans top-level directories for patterns like `*-frontend/`, `client/`, `web/`, etc.
 * Returns the prefix string (e.g., "pikto-frontend/") or null.
 */
function detectMonorepoFrontend(fileList) {
  const allPaths = fileList.map(f => f.file_path || f.path || '');

  // Count files per top-level directory
  const dirFiles = {};
  for (const p of allPaths) {
    const slash = p.indexOf('/');
    if (slash > 0) {
      const topDir = p.substring(0, slash + 1);
      if (!dirFiles[topDir]) dirFiles[topDir] = [];
      dirFiles[topDir].push(p);
    }
  }

  // Score each directory for "frontend-ness"
  let best = null;
  let bestScore = 0;

  for (const [dir, paths] of Object.entries(dirFiles)) {
    const dirName = dir.replace('/', '').toLowerCase();
    let score = 0;

    // Name-based signals
    if (/front/.test(dirName)) score += 3;
    if (/client/.test(dirName)) score += 3;
    if (/web/.test(dirName)) score += 2;
    if (/ui/.test(dirName)) score += 2;
    if (/app/.test(dirName)) score += 1;

    // Content-based signals
    const hasJsx = paths.some(p => /\.(jsx|tsx)$/.test(p));
    const hasReactEntry = paths.some(p =>
      p.endsWith('/src/App.jsx') || p.endsWith('/src/App.tsx') ||
      p.endsWith('/src/main.jsx') || p.endsWith('/src/main.tsx') ||
      p.endsWith('/src/index.jsx') || p.endsWith('/src/index.tsx')
    );
    const hasPackageJson = paths.some(p => p === dir + 'package.json');
    const hasIndexHtml = paths.some(p => p === dir + 'index.html');

    if (hasJsx) score += 2;
    if (hasReactEntry) score += 3;
    if (hasPackageJson) score += 1;
    if (hasIndexHtml) score += 1;

    // Check package.json for react dependency
    if (hasPackageJson) {
      const pkgFile = fileList.find(f => (f.file_path || f.path || '') === dir + 'package.json');
      if (pkgFile?.content) {
        try {
          const pkg = JSON.parse(pkgFile.content);
          const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          if (deps.react) score += 3;
          if (deps.vue) score += 3;
          if (deps.svelte) score += 3;
          if (deps.next) score += 2;
          if (deps.vite) score += 2;
        } catch { /* ignore */ }
      }
    }

    if (score > bestScore) {
      bestScore = score;
      best = dir;
    }
  }

  return bestScore >= 3 ? best : null;
}

/**
 * Analyze files to determine engine type without relying on app_type.
 */
function analyzeFiles(fileList) {
  const paths = fileList.map(f => f.file_path || f.path || '');

  // React signals
  const hasJsx = paths.some(p => /\.(jsx|tsx)$/.test(p));
  const hasReactEntry = paths.some(p =>
    /^(src\/)?(App|main|index)\.(jsx|tsx)$/.test(p)
  );
  const pkgFile = fileList.find(f => (f.file_path || f.path || '') === 'package.json');
  let hasReactDep = false;
  let hasExpressDep = false;
  if (pkgFile?.content) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      hasReactDep = !!deps.react;
      hasExpressDep = !!deps.express;
    } catch { /* ignore */ }
  }

  if ((hasJsx || hasReactEntry) && hasReactDep) return 'react';
  if (hasJsx || hasReactEntry) return 'react';

  // Static signals
  const hasIndexHtml = paths.some(p =>
    p === 'index.html' || p === 'public/index.html'
  );
  if (hasIndexHtml && !hasReactDep) return 'static';

  // Express signals
  const hasExpressPatterns = fileList.some(f => {
    const content = f.content || '';
    return /\bexpress\s*\(\s*\)/.test(content) || /\bcreateServer\s*\(/.test(content);
  });
  if (hasExpressDep || hasExpressPatterns) return 'express';

  // Majority CommonJS → express
  const jsFiles = fileList.filter(f => /\.(js|ts)$/.test(f.file_path || f.path || ''));
  const cjsCount = jsFiles.filter(f => /\brequire\s*\(/.test(f.content || '')).length;
  if (jsFiles.length > 0 && cjsCount / jsFiles.length > 0.5) return 'express';

  // Has any HTML at all → static
  if (paths.some(p => /\.html$/.test(p))) return 'static';

  return 'express'; // ultimate fallback
}

/**
 * Detect which preview engine to use for a project.
 *
 * @param {Object} project - Project object with app_type
 * @param {Array} fileList - Array of { file_path, content } objects
 * @returns {{ engine: 'react'|'static'|'express', filePrefix: string|null }}
 */
export function detectEngine(project, fileList) {
  const appType = (project?.app_type || '').toLowerCase().trim();

  // Step 1: Explicit app_type match
  if (REACT_TYPES.has(appType)) {
    const prefix = detectMonorepoFrontend(fileList);
    return { engine: 'react', filePrefix: prefix };
  }
  if (STATIC_TYPES.has(appType)) {
    const prefix = detectMonorepoFrontend(fileList);
    return { engine: 'static', filePrefix: prefix };
  }
  if (EXPRESS_TYPES.has(appType)) {
    return { engine: 'express', filePrefix: null };
  }

  // Step 2: Monorepo detection — try frontend subset first
  const prefix = detectMonorepoFrontend(fileList);
  if (prefix) {
    const subset = fileList
      .filter(f => (f.file_path || f.path || '').startsWith(prefix))
      .map(f => ({ ...f, file_path: (f.file_path || f.path || '').slice(prefix.length) }));

    if (subset.length > 0) {
      const engine = analyzeFiles(subset);
      return { engine, filePrefix: prefix };
    }
  }

  // Step 3: Analyze all files
  const engine = analyzeFiles(fileList);
  return { engine, filePrefix: null };
}
