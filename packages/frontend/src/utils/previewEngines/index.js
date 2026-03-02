/**
 * Preview Engines — Public API
 *
 * Detects the project type and generates the appropriate
 * in-browser preview HTML for the iframe.
 */

import { detectEngine } from './detectEngine.js';
import { buildReactPreview } from './reactEngine.js';
import { buildStaticPreview } from './staticEngine.js';
import { buildExpressPreview } from './expressEngine.js';

/**
 * Build a preview for a project using the appropriate engine.
 *
 * @param {Object} project - Project object with app_type, name, etc.
 * @param {Array} fileList - Array of { file_path, content } objects
 * @returns {{ html: string|null, engine: string|null, engineLabel: string }}
 */
export function buildPreview(project, fileList) {
  if (!fileList || fileList.length === 0) {
    return { html: null, engine: null, engineLabel: '' };
  }

  const { engine, filePrefix } = detectEngine(project, fileList);
  console.log('[Preview] Detected engine:', engine, filePrefix ? `(prefix: ${filePrefix})` : '');

  let html = null;
  let engineLabel = '';

  switch (engine) {
    case 'react': {
      html = buildReactPreview(fileList, filePrefix);
      engineLabel = 'React preview';
      // Fallback: if React engine finds no components, try static
      if (!html) {
        html = buildStaticPreview(fileList, filePrefix);
        if (html) {
          engineLabel = 'Static preview';
          console.log('[Preview] React engine returned null, falling back to static');
          return { html, engine: 'static', engineLabel };
        }
      }
      break;
    }
    case 'static': {
      html = buildStaticPreview(fileList, filePrefix);
      engineLabel = 'Static preview';
      break;
    }
    case 'express': {
      html = buildExpressPreview(fileList, filePrefix);
      engineLabel = 'API documentation';
      break;
    }
  }

  return { html, engine, engineLabel };
}
