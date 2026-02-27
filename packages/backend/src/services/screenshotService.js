/**
 * Screenshot Service
 *
 * Uses Playwright to capture screenshots of deployed applications.
 * Screenshots are stored locally for now (Phase 3), with S3 planned for later.
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/environment');
const logger = require('../config/logger');

const SCREENSHOTS_DIR = path.resolve(__dirname, '../../../../uploads/screenshots');

// Ensure directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

class ScreenshotService {
  constructor() {
    this._browser = null;
    logger.info('ScreenshotService initialized');
  }

  /**
   * Get or launch a Playwright browser instance.
   * Lazy-loaded to avoid startup cost when not needed.
   */
  async _getBrowser() {
    if (this._browser) return this._browser;

    try {
      const { chromium } = require('playwright');
      this._browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      logger.info('Playwright browser launched');
      return this._browser;
    } catch (err) {
      logger.error('Failed to launch Playwright browser', { error: err.message });
      throw new Error('Screenshot service unavailable: Playwright not installed. Run: npx playwright install chromium');
    }
  }

  /**
   * Capture a full-page desktop screenshot.
   */
  async captureFullPage(url, options = {}) {
    const {
      width = 1440,
      height = 900,
      waitForSelector,
      waitMs = 3000,
    } = options;

    const browser = await this._getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewportSize({ width, height });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

      if (waitForSelector) {
        await page.waitForSelector(waitForSelector, { timeout: 10000 }).catch(() => {});
      }

      // Wait a bit for animations/renders
      await page.waitForTimeout(waitMs);

      const filename = `${uuidv4()}-desktop.png`;
      const filepath = path.join(SCREENSHOTS_DIR, filename);

      await page.screenshot({
        path: filepath,
        fullPage: true,
        type: 'png',
      });

      const storageUrl = `/uploads/screenshots/${filename}`;

      logger.info('Full page screenshot captured', { url, filepath: storageUrl });

      return {
        filepath,
        storageUrl,
        width,
        height,
        type: 'desktop_full',
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Capture a mobile viewport screenshot.
   */
  async captureMobileView(url, options = {}) {
    const {
      width = 390,
      height = 844,
      waitMs = 3000,
    } = options;

    const browser = await this._getBrowser();
    const page = await browser.newPage();

    try {
      await page.setViewportSize({ width, height });
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(waitMs);

      const filename = `${uuidv4()}-mobile.png`;
      const filepath = path.join(SCREENSHOTS_DIR, filename);

      await page.screenshot({
        path: filepath,
        fullPage: false, // Just the viewport
        type: 'png',
      });

      const storageUrl = `/uploads/screenshots/${filename}`;

      logger.info('Mobile screenshot captured', { url, filepath: storageUrl });

      return {
        filepath,
        storageUrl,
        width,
        height,
        type: 'mobile',
      };
    } finally {
      await page.close();
    }
  }

  /**
   * Capture multiple states by navigating and interacting.
   * Each state object: { name, path, waitForSelector, actions }
   */
  async captureMultipleStates(baseUrl, states = []) {
    const browser = await this._getBrowser();
    const results = [];

    for (const state of states) {
      const page = await browser.newPage();
      try {
        await page.setViewportSize({ width: 1440, height: 900 });

        const url = state.path ? `${baseUrl}${state.path}` : baseUrl;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

        if (state.waitForSelector) {
          await page.waitForSelector(state.waitForSelector, { timeout: 10000 }).catch(() => {});
        }

        // Execute any actions (clicks, fills, etc.)
        if (state.actions) {
          for (const action of state.actions) {
            try {
              if (action.type === 'click') {
                await page.click(action.selector);
              } else if (action.type === 'fill') {
                await page.fill(action.selector, action.value);
              }
              await page.waitForTimeout(500);
            } catch (err) {
              logger.warn('Screenshot action failed', {
                state: state.name,
                action: action.type,
                error: err.message,
              });
            }
          }
        }

        await page.waitForTimeout(2000);

        const filename = `${uuidv4()}-${state.name || 'state'}.png`;
        const filepath = path.join(SCREENSHOTS_DIR, filename);

        await page.screenshot({
          path: filepath,
          fullPage: false,
          type: 'png',
        });

        results.push({
          name: state.name,
          filepath,
          storageUrl: `/uploads/screenshots/${filename}`,
          type: 'state',
        });
      } catch (err) {
        logger.error('Failed to capture state screenshot', {
          state: state.name,
          error: err.message,
        });
      } finally {
        await page.close();
      }
    }

    return results;
  }

  /**
   * Clean up browser on shutdown.
   */
  async close() {
    if (this._browser) {
      await this._browser.close();
      this._browser = null;
      logger.info('Playwright browser closed');
    }
  }
}

const screenshotService = new ScreenshotService();
module.exports = screenshotService;
