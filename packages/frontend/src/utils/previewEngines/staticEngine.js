/**
 * Static HTML Preview Engine
 *
 * Renders static HTML projects by inlining CSS and JS files
 * referenced via <link> and <script> tags. No build step needed.
 */

/**
 * Build a static HTML preview by inlining local assets.
 *
 * @param {Array} rawFileList - Array of { file_path, content } objects
 * @param {string|null} filePrefix - Monorepo prefix to strip
 * @returns {string|null} - HTML string for srcDoc, or null if no HTML files found
 */
export function buildStaticPreview(rawFileList, filePrefix = null) {
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

  // Build file map
  const fileMap = {};
  for (const f of fileList) {
    const p = f.file_path || f.path || '';
    fileMap[p] = f.content || '';
  }

  // Find main HTML file
  const htmlCandidates = ['index.html', 'public/index.html'];
  let htmlPath = htmlCandidates.find(p => fileMap[p]);
  if (!htmlPath) {
    // Try any .html file
    htmlPath = Object.keys(fileMap).find(p => /\.html$/.test(p));
  }
  if (!htmlPath) return null;

  let html = fileMap[htmlPath];
  const htmlDir = htmlPath.includes('/') ? htmlPath.substring(0, htmlPath.lastIndexOf('/') + 1) : '';

  // Resolve a relative path from the HTML file's directory
  const resolve = (href) => {
    const clean = href.replace(/^\.\//, '');
    // Try exact path first, then relative to HTML dir
    if (fileMap[clean]) return clean;
    if (htmlDir && fileMap[htmlDir + clean]) return htmlDir + clean;
    // Try without leading slash
    const noSlash = clean.replace(/^\//, '');
    if (fileMap[noSlash]) return noSlash;
    return null;
  };

  // Inline <link rel="stylesheet" href="..."> with local CSS
  html = html.replace(
    /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    (match, href) => {
      if (/^https?:\/\//.test(href)) return match; // keep external
      const resolved = resolve(href);
      if (resolved && fileMap[resolved]) {
        return `<style>/* ${href} */\n${fileMap[resolved]}</style>`;
      }
      return match;
    }
  );
  // Also handle href before rel
  html = html.replace(
    /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
    (match, href) => {
      if (/^https?:\/\//.test(href)) return match;
      const resolved = resolve(href);
      if (resolved && fileMap[resolved]) {
        return `<style>/* ${href} */\n${fileMap[resolved]}</style>`;
      }
      return match;
    }
  );

  // Inline <script src="..."> with local JS
  html = html.replace(
    /<script\s+[^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
    (match, src) => {
      if (/^https?:\/\//.test(src)) return match; // keep external CDN
      const resolved = resolve(src);
      if (resolved && fileMap[resolved]) {
        return `<script>/* ${src} */\n${fileMap[resolved]}<\/script>`;
      }
      return match;
    }
  );

  // Add error boundary if not already present
  if (!html.includes('window.onerror')) {
    const errorScript = `
<script>
  window.onerror = function(msg) {
    try { window.parent.postMessage({ type: 'preview-error', error: String(msg).substring(0, 500) }, '*'); } catch(_){}
  };
<\/script>`;
    // Insert before </body> or at end
    if (html.includes('</body>')) {
      html = html.replace('</body>', errorScript + '\n</body>');
    } else {
      html += errorScript;
    }
  }

  console.log('[Preview] Static engine: rendered', htmlPath);
  return html;
}
