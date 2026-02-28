const axios = require('axios');
const logger = require('../config/logger');

// cheerio is ESM-only in v1.x; use dynamic import
let cheerioReady;
let cheerioLoad;

function ensureCheerio() {
  if (!cheerioReady) {
    cheerioReady = import('cheerio').then((mod) => {
      cheerioLoad = mod.load;
    });
  }
  return cheerioReady;
}

// URL regex: matches http/https URLs in free text
const URL_REGEX = /https?:\/\/[^\s<>"')\]},]+/gi;

// Domains to skip (images, videos, binary files, auth pages, etc.)
const SKIP_PATTERNS = [
  /\.(png|jpg|jpeg|gif|svg|ico|webp|bmp|tiff)(\?|$)/i,
  /\.(mp4|webm|avi|mov|mkv|flv)(\?|$)/i,
  /\.(mp3|wav|ogg|flac|aac)(\?|$)/i,
  /\.(pdf|zip|tar|gz|rar|7z|exe|dmg|iso)(\?|$)/i,
  /\.(woff|woff2|ttf|eot|otf)(\?|$)/i,
];

const MAX_CONTENT_LENGTH = 15000; // chars of extracted text per URL
const FETCH_TIMEOUT = 10000; // 10s
const MAX_URLS = 3; // max URLs to extract per message

/**
 * Detect URLs in a message string.
 * @param {string} content
 * @returns {string[]} Array of unique URLs found
 */
function detectUrls(content) {
  if (!content || typeof content !== 'string') return [];
  const matches = content.match(URL_REGEX) || [];
  // Deduplicate and clean trailing punctuation
  const cleaned = matches.map((url) => url.replace(/[.,;:!?)]+$/, ''));
  return [...new Set(cleaned)].slice(0, MAX_URLS);
}

/**
 * Check if a URL should be skipped (binary files, images, etc.)
 * @param {string} url
 * @returns {boolean}
 */
function shouldSkip(url) {
  return SKIP_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Fetch and extract meaningful text content from a URL.
 * @param {string} url
 * @returns {Promise<{url: string, title: string, description: string, content: string, error?: string}>}
 */
async function extractUrl(url) {
  if (shouldSkip(url)) {
    return { url, title: '', description: '', content: '', error: 'Skipped (binary/media file)' };
  }

  await ensureCheerio();

  try {
    const response = await axios.get(url, {
      timeout: FETCH_TIMEOUT,
      maxContentLength: 5 * 1024 * 1024, // 5MB max download
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Imagia/1.0; +https://imagia.net)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      responseType: 'text',
      // Follow redirects
      maxRedirects: 5,
    });

    const contentType = response.headers['content-type'] || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { url, title: '', description: '', content: '', error: 'Not an HTML page' };
    }

    const html = response.data;
    const $ = cheerioLoad(html);

    // Remove script, style, nav, footer, header, aside elements
    $('script, style, noscript, nav, footer, header, aside, iframe, svg, form').remove();

    // Extract metadata
    const title = $('title').first().text().trim() ||
      $('meta[property="og:title"]').attr('content') || '';

    const description = $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') || '';

    // Extract main content - prefer article/main elements
    let mainContent = '';
    const mainEl = $('article, main, [role="main"], .content, .post, .entry, #content, #main');
    if (mainEl.length > 0) {
      mainContent = mainEl.first().text();
    } else {
      mainContent = $('body').text();
    }

    // Clean up whitespace
    const cleanedContent = mainContent
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim()
      .slice(0, MAX_CONTENT_LENGTH);

    return {
      url,
      title: title.slice(0, 200),
      description: description.slice(0, 500),
      content: cleanedContent,
    };
  } catch (err) {
    logger.warn('URL extraction failed', { url, error: err.message });
    return {
      url,
      title: '',
      description: '',
      content: '',
      error: err.message,
    };
  }
}

/**
 * Extract content from all URLs found in a message.
 * @param {string} messageContent - The user's message text
 * @returns {Promise<{urls: string[], extractions: Array}>}
 */
async function extractUrlsFromMessage(messageContent) {
  const urls = detectUrls(messageContent);
  if (urls.length === 0) return { urls: [], extractions: [] };

  const extractions = await Promise.all(urls.map((url) => extractUrl(url)));
  const successful = extractions.filter((e) => !e.error && e.content.length > 0);

  return { urls, extractions: successful };
}

/**
 * Build an enriched message that appends extracted URL content.
 * The original message is kept intact; extracted content is appended
 * in a structured format the LLM can use as reference.
 *
 * @param {string} originalContent - The user's original message
 * @param {Array} extractions - Successful extraction results
 * @returns {string} Enriched message content
 */
function buildEnrichedMessage(originalContent, extractions) {
  if (!extractions || extractions.length === 0) return originalContent;

  let enriched = originalContent;
  enriched += '\n\n---\nREFERENCE CONTENT FROM URLS:\n';

  for (const ext of extractions) {
    enriched += `\n[Source: ${ext.url}]\n`;
    if (ext.title) enriched += `Title: ${ext.title}\n`;
    if (ext.description) enriched += `Description: ${ext.description}\n`;
    enriched += `Content:\n${ext.content}\n`;
    enriched += '---\n';
  }

  return enriched;
}

module.exports = {
  detectUrls,
  extractUrl,
  extractUrlsFromMessage,
  buildEnrichedMessage,
};
