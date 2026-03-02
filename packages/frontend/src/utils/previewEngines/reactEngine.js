/**
 * React Preview Engine
 *
 * Generates an in-browser preview for React/Vite/Next.js projects.
 * Extracts JSX components from project files, loads npm deps via esm.sh,
 * transpiles with Babel standalone, and renders in an iframe.
 *
 * This is the extracted logic from PreviewTab's useMemo blocks.
 */

/**
 * Build a React in-browser preview from project files.
 *
 * @param {Array} rawFileList - Array of { file_path, content, language } objects
 * @param {string|null} filePrefix - Monorepo prefix to strip (e.g., "pikto-frontend/")
 * @returns {string|null} - HTML string for srcDoc, or null if no renderable components
 */
export function buildReactPreview(rawFileList, filePrefix = null) {
  // Normalize monorepo paths
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

  if (fileList.length === 0) return null;

  // ---- Import Map ----
  const { importMapJson, depsCssLinks } = buildImportMap(fileList);

  // ---- File Map ----
  const fileMap = {};
  for (const f of fileList) {
    const path = f.file_path || f.path || '';
    fileMap[path] = f.content || '';
  }

  // ---- CSS ----
  const cssKeys = Object.keys(fileMap).filter(k => /\.(css|scss)$/.test(k)).sort();
  const primaryCssKey = ['src/index.css', 'src/globals.css', 'src/app/globals.css', 'src/styles/globals.css', 'styles/globals.css', 'app/globals.css', 'index.css', 'globals.css']
    .find(k => fileMap[k]) || cssKeys[0] || '';
  const indexCss = fileMap[primaryCssKey] || '';
  const cleanCss = indexCss
    .replace(/@tailwind\s+\w+;/g, '')
    .replace(/@import\s+.*$/gm, '')
    .replace(/@layer\s+\w+\s*\{[\s\S]*?\}/g, '')
    .replace(/@apply\s+[^;]+;/g, '');

  // ---- Helpers ----
  const toIdentifier = (path) => {
    const basename = path.split('/').pop();
    let name = basename.replace(/\.(jsx|tsx|js|ts)$/, '').replace(/[^a-zA-Z0-9_$]/g, '');
    if (/^[0-9]/.test(name)) name = '_' + name;
    return name;
  };

  const rewriteImports = (code, name) => {
    let c = code;
    c = c.replace(/^import\s+.*$/gm, '');
    c = c.replace(/^.*\brequire\s*\(.*$/gm, '');
    c = c.replace(/^module\.exports\b.*$/gm, '');
    c = c.replace(/^exports\.\w+\s*=.*$/gm, '');
    c = c.replace(/^.*\bprocess\.env\b.*$/gm, '');
    c = c.replace(/^.*\bmongoose\b.*$/gm, '');
    c = c.replace(/^.*\bexpress\s*\(.*$/gm, '');
    c = c.replace(/^export\s+default\s+function\s+\w+/gm, `function ${name}`);
    c = c.replace(/^export\s+default\s+function\s*(?=\()/gm, `function ${name}`);
    c = c.replace(/^export\s+default\s+class\s+\w+/gm, `var ${name} = class ${name}`);
    c = c.replace(/^export\s+default\s+/gm, `var ${name} = `);
    c = c.replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ');
    c = c.replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
    const defMatch = c.match(/^(?:function|var|const|let)\s+([A-Z]\w*)/m);
    if (defMatch && defMatch[1] !== name) {
      c += `\nvar ${name} = ${defMatch[1]};`;
    }
    return c;
  };

  // ---- Collect npm imports ----
  const npmImportEntries = [];
  const seenImports = new Set();
  for (const f of fileList) {
    const content = f.content || '';
    const importRegex = /^import\s+(.*?)\s+from\s+['"]([^.'"][^'"]*?)['"];?\s*$/gm;
    let m;
    while ((m = importRegex.exec(content)) !== null) {
      const clause = m[1].trim();
      const pkg = m[2];
      if (pkg.startsWith('.') || /\.(css|scss|sass|less)$/.test(pkg)) continue;
      if (pkg === 'react' || pkg === 'react-dom' || pkg === 'react-dom/client') continue;
      const key = `${clause}::${pkg}`;
      if (seenImports.has(key)) continue;
      seenImports.add(key);

      const entry = { pkg, defaultName: null, namedImports: [], namespaceImport: null };
      const nsMatch = clause.match(/^\*\s+as\s+(\w+)$/);
      if (nsMatch) { entry.namespaceImport = nsMatch[1]; npmImportEntries.push(entry); continue; }
      const parts = clause.replace(/\s+/g, ' ');
      const braceMatch = parts.match(/\{([^}]*)\}/);
      if (braceMatch) {
        entry.namedImports = braceMatch[1].split(',').map(s => s.trim()).filter(Boolean);
      }
      const beforeBrace = parts.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
      if (beforeBrace) entry.defaultName = beforeBrace;
      npmImportEntries.push(entry);
    }
  }

  const dynamicImportLines = npmImportEntries.map(({ pkg, defaultName, namedImports, namespaceImport }) => {
    const escapedPkg = pkg.replace(/'/g, "\\'");
    if (namespaceImport) {
      return `const ${namespaceImport} = await import('${escapedPkg}').catch(() => ({}));`;
    }
    const lines = [];
    if (defaultName && namedImports.length > 0) {
      lines.push(`const _mod_${defaultName} = await import('${escapedPkg}').catch(() => ({}));`);
      lines.push(`const ${defaultName} = _mod_${defaultName}.default || _mod_${defaultName};`);
      const destructure = namedImports.map(n => {
        const asMatch = n.match(/^(\w+)\s+as\s+(\w+)$/);
        return asMatch ? `${asMatch[1]}: ${asMatch[2]}` : n;
      }).join(', ');
      lines.push(`const { ${destructure} } = _mod_${defaultName};`);
    } else if (defaultName) {
      lines.push(`const _mod_${defaultName} = await import('${escapedPkg}').catch(() => ({}));`);
      lines.push(`const ${defaultName} = _mod_${defaultName}.default || _mod_${defaultName};`);
    } else if (namedImports.length > 0) {
      const destructure = namedImports.map(n => {
        const asMatch = n.match(/^(\w+)\s+as\s+(\w+)$/);
        return asMatch ? `${asMatch[1]}: ${asMatch[2]}` : n;
      }).join(', ');
      lines.push(`const { ${destructure} } = await import('${escapedPkg}').catch(() => ({}));`);
    }
    return lines.join('\n      ');
  });

  // ---- Filter & collect components ----
  const skipPatterns = [
    /node_modules\//,
    /\.(test|spec|stories|d)\.(js|jsx|ts|tsx)$/,
    /\.(config|setup)\.(js|ts|mjs|cjs)$/,
    /(vite|webpack|babel|jest|tailwind|postcss|tsconfig|next)\./,
    /\.env/,
    /package\.json$/,
    /README/i,
    /LICENSE/i,
    /\b(server|controllers|middleware|migrations|seeds|db|prisma|knex|cron)\b\//i,
    /\bserver\.(js|ts)$/,
  ];
  const entryFilePatterns = [
    /^(src\/)?(main|index)\.(jsx|tsx|js|ts)$/,
  ];

  const isBackendContent = (content) => {
    const c = content.replace(/\r\n?/g, '\n');
    if (/\brequire\s*\(/.test(c)) return true;
    if (/\bmodule\.exports\b/.test(c)) return true;
    if (/\bexports\.\w+\s*=/.test(c)) return true;
    if (/\bexpress\s*\(\s*\)/.test(c)) return true;
    if (/\bmongoose\.(connect|model|Schema)\b/.test(c)) return true;
    if (/\bcreateServer\s*\(/.test(c)) return true;
    if (/^#!\//.test(c)) return true;
    return false;
  };

  const collected = new Map();
  const _debugSkipped = { noContent: 0, notJsx: 0, skipPattern: 0, entryFile: 0, backend: 0, noReact: 0, postRewrite: 0 };
  const _debugPaths = [];
  for (const f of fileList) {
    const path = f.file_path || f.path || '';
    if (!f.content) { _debugSkipped.noContent++; continue; }
    if (!/\.(jsx|tsx|js|ts)$/.test(path)) { _debugSkipped.notJsx++; continue; }
    if (skipPatterns.some(p => p.test(path))) { _debugSkipped.skipPattern++; _debugPaths.push('skip:' + path); continue; }
    if (entryFilePatterns.some(p => p.test(path))) { _debugSkipped.entryFile++; _debugPaths.push('entry:' + path); continue; }
    if (isBackendContent(f.content)) { _debugSkipped.backend++; _debugPaths.push('backend:' + path); continue; }
    const hasJSX = /<[A-Z]\w/.test(f.content) || /<[a-z]+[\s>]/.test(f.content);
    const hasReactPatterns = /\b(useState|useEffect|useRef|useCallback|useMemo|React\.createElement|createContext|forwardRef)\b/.test(f.content);
    const hasExportDefault = /\bexport\s+default\b/.test(f.content);
    if (!hasJSX && !hasReactPatterns && !hasExportDefault) { _debugSkipped.noReact++; _debugPaths.push('noReact:' + path); continue; }

    const name = toIdentifier(path);
    if (!name) continue;

    const rewritten = rewriteImports(f.content, name);
    if (/\brequire\s*\(/.test(rewritten) || /\bmodule\.exports\b/.test(rewritten)) { _debugSkipped.postRewrite++; _debugPaths.push('postRewrite:' + path); continue; }

    const isPage = /\b(pages?|views?|screens?|routes?|app)\b/i.test(path)
      || /^(src\/)?App\.(jsx|tsx|js|ts)$/.test(path)
      || /^(src\/)?[^/]+\.(jsx|tsx)$/.test(path);

    const hasExt = /\.(jsx|tsx)$/.test(path);
    const priority = hasExt ? 1 : 0;
    const existing = collected.get(name);
    if (existing && existing.priority >= priority) continue;

    collected.set(name, { name, code: rewritten, isPage, priority });
  }

  // Split into pages and components
  const pageScripts = [];
  const componentScripts = [];
  const pageNames = [];
  for (const [name, entry] of collected) {
    if (entry.isPage) {
      pageScripts.push(entry.code);
      pageNames.push(name);
    } else {
      componentScripts.push(entry.code);
    }
  }

  // If no pages found, promote all components to pages
  if (pageNames.length === 0 && componentScripts.length > 0) {
    for (const [name, entry] of collected) {
      pageNames.push(name);
    }
    pageScripts.push(...componentScripts.splice(0));
  }

  // Diagnostic logging
  console.log('[Preview] React engine pipeline:', { totalFiles: fileList.length, collected: collected.size, pages: pageNames.length, components: componentScripts.length, skipped: _debugSkipped });
  if (_debugPaths.length > 0) console.log('[Preview] Filtered paths:', _debugPaths.slice(0, 20));
  if (pageNames.length > 0) console.log('[Preview] Pages:', pageNames, 'Components:', [...collected.keys()].filter(n => !pageNames.includes(n)));

  if (pageNames.length === 0) return null;

  const homePage = ['App', 'Home', 'Index', 'Page', 'Main', 'Root', 'Layout', 'Dashboard'].find(n => pageNames.includes(n)) || pageNames[0] || '';

  const escapeForScript = (str) => str
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/<\/script>/gi, '<\\/script>');

  const allComponentCode = [...componentScripts, ...pageScripts].join('\n\n');
  const validIdent = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/;
  const allNames = [...new Set([...pageNames, ...[...collected.keys()]])].filter(n => validIdent.test(n));
  const windowExportCode = allNames.map(n => `try{window["${n}"]=${n}}catch(_){}`).join(';');

  const renderExpr = homePage
    ? `typeof window.${homePage} === 'function' ? React.createElement(window.${homePage}) : null`
    : pageNames.length > 0
      ? pageNames.map(n => `typeof window.${n} === 'function' ? React.createElement(window.${n}) : null`).join(' || ') + ' || null'
      : 'null';

  const cssLinkTags = depsCssLinks.map(url => `<link rel="stylesheet" href="${url}" />`).join('\n  ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <script type="importmap">${importMapJson}<\/script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"><\/script>
  <script src="https://cdn.tailwindcss.com"><\/script>
  ${cssLinkTags}
  <style>${escapeForScript(cleanCss)}</style>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    img[src=""], img:not([src]) { display: inline-block; background: #e5e7eb; min-height: 40px; min-width: 40px; }
    #loading { display: flex; align-items: center; justify-content: center; height: 100vh; color: #9ca3af; font-size: 14px; flex-direction: column; gap: 8px; }
    #loading .spinner { width: 24px; height: 24px; border: 3px solid #e5e7eb; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #timeout-msg { display: none; text-align: center; padding: 2rem; color: #6b7280; }
    #timeout-msg h3 { font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 4px; }
    #timeout-msg p { font-size: 12px; }
  </style>
</head>
<body>
  <div id="root"><div id="loading"><div class="spinner"></div>Loading preview...</div></div>
  <div id="err" style="display:none;padding:1rem;color:#dc2626;font-size:13px;font-family:monospace;white-space:pre-wrap;background:#fef2f2;border:2px solid #fca5a5;border-radius:8px;margin:1rem;max-height:40vh;overflow:auto"></div>
  <div id="timeout-msg"><h3>Preview not available</h3><p>This project may need to be deployed for a full preview.</p></div>
  <script>
    var _rendered = false;
    window.onerror = function(msg, src, line, col, err) { showError(err ? err.stack : msg); };
    window.addEventListener('unhandledrejection', function(e) { showError('Unhandled: ' + (e.reason?.message || e.reason || 'unknown')); });
    function showError(msg) {
      var el = document.getElementById('err');
      el.style.display = 'block';
      el.textContent += msg + String.fromCharCode(10, 10);
      try { window.parent.postMessage({ type: 'preview-error', error: String(msg).substring(0, 500) }, '*'); } catch(_){}
      if (!_rendered) {
        document.getElementById('timeout-msg').style.display = 'block';
        var ld = document.getElementById('loading');
        if (ld) ld.style.display = 'none';
      }
    }
    setTimeout(function() {
      if (!_rendered) {
        document.getElementById('timeout-msg').style.display = 'block';
        var ld = document.getElementById('loading');
        if (ld) ld.style.display = 'none';
      }
    }, 15000);
  <\/script>
  <script type="module">
  (async () => {
    try {
      const _reactMod = await import('react').catch(e => { showError('React load failed: ' + e.message); return null; });
      const _reactDomMod = await import('react-dom/client').catch(e => { showError('ReactDOM load failed: ' + e.message); return null; });
      if (!_reactMod || !_reactMod.createElement) { showError('React failed to load from esm.sh CDN'); return; }
      window.React = _reactMod;
      window.ReactDOM = _reactDomMod || {};
      const React = _reactMod;
      const ReactDOM = _reactDomMod || {};
      const { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer, Fragment, createContext, forwardRef, memo, lazy, Suspense } = React;

      ${dynamicImportLines.join('\n      ')}

      // React Router shims
      const _noop = () => {};
      const _noopNav = () => _noop;
      const BrowserRouter = (p) => p.children;
      const Router = BrowserRouter;
      const HashRouter = BrowserRouter;
      const Routes = (p) => { const arr = React.Children.toArray(p.children); return arr.length ? (arr[0].props.element || arr[0].props.children || null) : null; };
      const Switch = Routes;
      const Route = (p) => p.element || p.children || null;
      const Redirect = () => null;
      const NavLink = (p) => React.createElement('a', { href: p.to || '#', className: typeof p.className === 'function' ? p.className({ isActive: false }) : p.className, onClick: (e) => e.preventDefault() }, p.children);
      const Outlet = () => null;
      const useNavigate = _noopNav;
      const useLocation = () => ({ pathname: '/', search: '', hash: '' });
      const useParams = () => ({});
      const useSearchParams = () => [new URLSearchParams(), _noop];

      // Next.js shims
      const Link = (p) => React.createElement('a', { ...p, href: p.href || p.to || '#', onClick: (e) => e.preventDefault(), to: undefined, legacyBehavior: undefined }, p.children);
      const Image = (p) => React.createElement('img', { src: p.src || '', alt: p.alt || '', width: p.width, height: p.height, className: p.className, style: p.fill ? { objectFit: 'cover', width: '100%', height: '100%' } : undefined });
      const useRouter = () => ({ pathname: '/', query: {}, push: _noop, back: _noop, replace: _noop });
      const usePathname = () => '/';

      // Icon/library fallbacks
      const _iconProxy = typeof Proxy !== 'undefined' ? new Proxy({}, { get: (_, name) => (props) => React.createElement('span', props) }) : {};

      if (typeof Babel === 'undefined') { showError('Babel failed to load'); return; }

      const jsxCode = \`${escapeForScript(allComponentCode)}\`;

      console.log('[Preview] JSX code length:', jsxCode.length, 'chars');
      console.log('[Preview] Will try to render: ${homePage || pageNames[0] || 'none'}');

      var _transformedCode;
      try {
        _transformedCode = Babel.transform(jsxCode, {
          presets: ['react', ['typescript', { allExtensions: true, isTSX: true }]],
          filename: 'preview.tsx',
        }).code;
        console.log('[Preview] Babel transform OK, output length:', _transformedCode.length);
      } catch (babelErr) {
        showError('Babel transform failed: ' + babelErr.message);
        return;
      }

      try {
        var _evalCode = _transformedCode.replace(/^"use strict";?\\s*/gm, '');
        _evalCode = _evalCode.replace(/^(const|let) /gm, 'var ');
        _evalCode += ';${windowExportCode}';
        console.log('[Preview] Eval code:', _evalCode.substring(0, 500));
        (0, eval)(_evalCode);
        console.log('[Preview] Eval OK, window exports:', ${JSON.stringify(allNames)}.map(n => n + '=' + typeof window[n]).join(', '));
      } catch (evalErr) {
        showError('Code eval failed: ' + evalErr.message);
        return;
      }

      try {
        const _root = ReactDOM.createRoot(document.getElementById('root'));
        console.log('[Preview] Checking components:', ${JSON.stringify(pageNames)}.map(n => n + '=' + typeof window[n]).join(', '));
        const _el = ${renderExpr};
        if (_el) {
          window._rendered = true;
          _root.render(_el);
          console.log('[Preview] Rendered successfully');
        } else {
          showError('No renderable component found. Available: ${pageNames.join(', ')}');
        }
      } catch(_re) {
        showError('Render error: ' + _re.message);
      }
    } catch (moduleErr) {
      showError('Module: ' + moduleErr.message + ' | ' + (moduleErr.stack || ''));
    }
  })();
  <\/script>
</body>
</html>`;
}

// ---- Internal helpers ----

function buildImportMap(fileList) {
  const pkgFile = fileList.find(f => (f.file_path || f.path || '') === 'package.json');
  const imports = {
    'react': 'https://esm.sh/react@18?dev',
    'react/': 'https://esm.sh/react@18&dev/',
    'react-dom': 'https://esm.sh/react-dom@18?dev&deps=react@18',
    'react-dom/': 'https://esm.sh/react-dom@18&dev&deps=react@18/',
    'react-dom/client': 'https://esm.sh/react-dom@18/client?dev&deps=react@18',
  };
  const cssLinks = [];
  if (pkgFile?.content) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      const shimmed = new Set([
        'react', 'react-dom', 'next', 'next/link', 'next/image', 'next/navigation', 'next/router',
        'tailwindcss',
      ]);
      for (const [name, version] of Object.entries(deps)) {
        if (shimmed.has(name)) continue;
        const cleanVer = version.replace(/^[\^~>=<]+/, '');
        const esmUrl = `https://esm.sh/${name}@${cleanVer}?deps=react@18,react-dom@18`;
        imports[name] = esmUrl;
        imports[name + '/'] = `https://esm.sh/${name}@${cleanVer}&deps=react@18,react-dom@18/`;
      }
    } catch { /* ignore parse errors */ }
  }
  return { importMapJson: JSON.stringify({ imports }, null, 2), depsCssLinks: cssLinks };
}
