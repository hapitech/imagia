/**
 * Express/Node API Preview Engine
 *
 * Generates a styled API documentation page for backend projects.
 * Extracts routes, dependencies, and file structure from the project files.
 */

/**
 * Build an Express API documentation preview.
 *
 * @param {Array} rawFileList - Array of { file_path, content } objects
 * @param {string|null} filePrefix - Monorepo prefix to strip
 * @returns {string} - HTML string (always returns something, never null)
 */
export function buildExpressPreview(rawFileList, filePrefix = null) {
  let fileList = rawFileList;
  if (filePrefix) {
    fileList = rawFileList
      .filter(f => (f.file_path || f.path || '').startsWith(filePrefix))
      .map(f => ({
        ...f,
        file_path: (f.file_path || f.path || '').slice(filePrefix.length),
        path: undefined,
      }));
  }

  const fileMap = {};
  for (const f of fileList) {
    const p = f.file_path || f.path || '';
    fileMap[p] = f.content || '';
  }

  // Parse package.json
  let projectName = 'API Server';
  let projectDesc = '';
  const deps = {};
  const pkgContent = fileMap['package.json'];
  if (pkgContent) {
    try {
      const pkg = JSON.parse(pkgContent);
      projectName = pkg.name || projectName;
      projectDesc = pkg.description || '';
      Object.assign(deps, pkg.dependencies || {});
    } catch { /* ignore */ }
  }

  // Extract routes from all JS/TS files
  const routes = [];
  const routeRegex = /\b(?:app|router)\.(get|post|put|patch|delete|use|all)\s*\(\s*['"`]([^'"`]+)['"`]/g;

  for (const [path, content] of Object.entries(fileMap)) {
    if (!/\.(js|ts|mjs)$/.test(path)) continue;
    let m;
    const regex = new RegExp(routeRegex.source, routeRegex.flags);
    while ((m = regex.exec(content)) !== null) {
      const method = m[1].toUpperCase();
      const routePath = m[2];
      // Skip middleware-style use() with non-path args
      if (method === 'USE' && !routePath.startsWith('/')) continue;
      routes.push({ method: method === 'USE' ? 'USE' : method, path: routePath, file: path });
    }
  }

  // Sort routes: by path, then by method
  routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));

  // Build file tree
  const filePaths = Object.keys(fileMap).sort();

  // Identify entry point
  const entryFile = ['server.js', 'app.js', 'index.js', 'src/server.js', 'src/app.js', 'src/index.js']
    .find(p => fileMap[p]) || filePaths[0] || '';

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const methodColor = {
    GET: '#22c55e', POST: '#3b82f6', PUT: '#f59e0b',
    PATCH: '#f59e0b', DELETE: '#ef4444', USE: '#8b5cf6', ALL: '#6b7280',
  };

  const routeHtml = routes.length > 0
    ? routes.map(r => {
        const color = methodColor[r.method] || '#6b7280';
        return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:#fff;border-radius:8px;border-left:4px solid ${color};margin-bottom:6px">
          <span style="font-family:monospace;font-weight:700;font-size:13px;color:${color};min-width:56px">${esc(r.method)}</span>
          <span style="font-family:monospace;font-size:13px;color:#374151">${esc(r.path)}</span>
          <span style="margin-left:auto;font-size:11px;color:#9ca3af">${esc(r.file)}</span>
        </div>`;
      }).join('\n')
    : '<p style="color:#9ca3af;font-size:13px;padding:12px">No routes detected from static analysis.</p>';

  const depsHtml = Object.entries(deps).length > 0
    ? Object.entries(deps).map(([name, ver]) =>
        `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6">
          <span style="font-family:monospace;font-size:13px;color:#374151">${esc(name)}</span>
          <span style="font-family:monospace;font-size:12px;color:#9ca3af">${esc(ver)}</span>
        </div>`
      ).join('\n')
    : '<p style="color:#9ca3af;font-size:13px">No dependencies found.</p>';

  const filesHtml = filePaths.map(p =>
    `<div style="padding:3px 0;font-family:monospace;font-size:12px;color:#6b7280">${esc(p)}</div>`
  ).join('\n');

  console.log('[Preview] Express engine:', { routes: routes.length, deps: Object.keys(deps).length, files: filePaths.length });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(projectName)} - API</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; }
    .header { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: white; padding: 32px 24px; }
    .header h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
    .header p { font-size: 13px; opacity: 0.85; }
    .badge { display: inline-block; background: rgba(255,255,255,0.2); border-radius: 12px; padding: 2px 10px; font-size: 11px; font-weight: 600; margin-top: 8px; }
    .content { max-width: 720px; margin: 0 auto; padding: 24px 16px; }
    .section { margin-bottom: 28px; }
    .section-title { font-size: 14px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    .section-count { background: #e2e8f0; color: #475569; border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
    .card { background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 16px; }
    .entry-badge { display: inline-block; background: #dbeafe; color: #1e40af; border-radius: 6px; padding: 2px 8px; font-size: 11px; font-weight: 600; font-family: monospace; }
    .deploy-cta { text-align: center; padding: 24px; background: #f1f5f9; border-radius: 12px; border: 2px dashed #cbd5e1; margin-top: 24px; }
    .deploy-cta h3 { font-size: 15px; font-weight: 600; color: #334155; margin-bottom: 4px; }
    .deploy-cta p { font-size: 12px; color: #64748b; }
  </style>
</head>
<body>
  <div class="header">
    <div style="display:flex;align-items:center;gap:12px">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
        <path d="M7 8l3 3-3 3M12 14h4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <div>
        <h1>${esc(projectName)}</h1>
        <p>${projectDesc ? esc(projectDesc) : 'Server-side application'}</p>
      </div>
    </div>
    <div class="badge">Node.js / Express</div>
  </div>

  <div class="content">
    ${entryFile ? `
    <div class="section">
      <div class="section-title">Entry Point</div>
      <div class="entry-badge">${esc(entryFile)}</div>
    </div>` : ''}

    <div class="section">
      <div class="section-title">Endpoints <span class="section-count">${routes.length}</span></div>
      <div>${routeHtml}</div>
    </div>

    <div class="section">
      <div class="section-title">Dependencies <span class="section-count">${Object.keys(deps).length}</span></div>
      <div class="card">${depsHtml}</div>
    </div>

    <div class="section">
      <div class="section-title">Files <span class="section-count">${filePaths.length}</span></div>
      <div class="card" style="max-height:200px;overflow:auto">${filesHtml}</div>
    </div>

    <div class="deploy-cta">
      <h3>This is a server-side application</h3>
      <p>Deploy to Railway to see it running live.</p>
    </div>
  </div>
</body>
</html>`;
}
