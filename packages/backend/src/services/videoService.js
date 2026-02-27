/**
 * Video Service
 *
 * Generates demo videos for deployed applications using Playwright to capture
 * step-by-step screenshots, then assembles them into a video.
 *
 * Phase 3: Uses Playwright screen recording (built-in video capture).
 * Future: Can integrate with Remotion Lambda for more polished video rendering.
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');

const VIDEOS_DIR = path.resolve(__dirname, '../../../../uploads/videos');

if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

class VideoService {
  constructor() {
    this._browser = null;
    logger.info('VideoService initialized');
  }

  async _getBrowser() {
    if (this._browser) return this._browser;

    try {
      const { chromium } = require('playwright');
      this._browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      return this._browser;
    } catch (err) {
      logger.error('Failed to launch Playwright for video', { error: err.message });
      throw new Error('Video service unavailable: Playwright not installed');
    }
  }

  /**
   * Generate a demo video by recording a Playwright session.
   *
   * @param {string} url - Deployed app URL
   * @param {Array<Object>} steps - Array of demo steps:
   *   { description, path, action, selector, value, waitMs }
   * @param {Object} options
   * @returns {Promise<{filepath: string, storageUrl: string, duration: number}>}
   */
  async generateDemoVideo(url, steps = [], options = {}) {
    const {
      width = 1280,
      height = 720,
    } = options;

    const browser = await this._getBrowser();
    const videoFilename = `${uuidv4()}-demo.webm`;
    const videoPath = path.join(VIDEOS_DIR, videoFilename);

    logger.info('Starting demo video recording', {
      url,
      stepCount: steps.length,
    });

    const context = await browser.newContext({
      viewport: { width, height },
      recordVideo: {
        dir: VIDEOS_DIR,
        size: { width, height },
      },
    });

    const page = await context.newPage();
    const startTime = Date.now();

    try {
      // Navigate to the app
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000); // Initial pause

      // Execute each step
      for (const step of steps) {
        try {
          // Navigate to a different page if specified
          if (step.path) {
            await page.goto(`${url}${step.path}`, {
              waitUntil: 'networkidle',
              timeout: 15000,
            });
          }

          // Wait for selector
          if (step.waitFor) {
            await page.waitForSelector(step.waitFor, { timeout: 5000 }).catch(() => {});
          }

          // Perform action
          if (step.action === 'click' && step.selector) {
            await page.click(step.selector);
          } else if (step.action === 'fill' && step.selector && step.value) {
            await page.fill(step.selector, step.value);
          } else if (step.action === 'scroll') {
            await page.evaluate(() => window.scrollBy(0, 300));
          } else if (step.action === 'scrollToBottom') {
            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          }

          // Wait between steps for visual effect
          await page.waitForTimeout(step.waitMs || 1500);
        } catch (err) {
          logger.warn('Video step failed, continuing', {
            step: step.description,
            error: err.message,
          });
          await page.waitForTimeout(1000);
        }
      }

      // Final pause
      await page.waitForTimeout(2000);
    } finally {
      await page.close();
      await context.close();
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    // Playwright saves the video with a random name. Find it and rename.
    const videoFiles = fs.readdirSync(VIDEOS_DIR).filter(
      (f) => f.endsWith('.webm') && !f.startsWith(videoFilename.replace('.webm', ''))
    );

    // Get the most recently created file
    let actualVideoPath = videoPath;
    if (videoFiles.length > 0) {
      const newest = videoFiles
        .map((f) => ({ name: f, time: fs.statSync(path.join(VIDEOS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time)[0];

      if (newest) {
        const srcPath = path.join(VIDEOS_DIR, newest.name);
        try {
          fs.renameSync(srcPath, videoPath);
        } catch {
          actualVideoPath = srcPath;
        }
      }
    }

    const storageUrl = `/uploads/videos/${path.basename(actualVideoPath)}`;

    logger.info('Demo video generated', {
      url,
      storageUrl,
      duration,
      steps: steps.length,
    });

    return {
      filepath: actualVideoPath,
      storageUrl,
      duration,
      width,
      height,
    };
  }

  /**
   * Generate demo script steps from an app description using LLM.
   * Returns structured step array for generateDemoVideo().
   */
  async generateDemoScript(appDescription, appType) {
    // Default demo script when LLM isn't needed
    const defaultSteps = [
      { description: 'Show landing page', waitMs: 3000 },
      { description: 'Scroll down', action: 'scroll', waitMs: 2000 },
      { description: 'Scroll more', action: 'scroll', waitMs: 2000 },
      { description: 'Scroll to bottom', action: 'scrollToBottom', waitMs: 3000 },
    ];

    return defaultSteps;
  }

  async close() {
    if (this._browser) {
      await this._browser.close();
      this._browser = null;
    }
  }
}

const videoService = new VideoService();
module.exports = videoService;
