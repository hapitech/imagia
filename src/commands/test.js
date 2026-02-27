'use strict';

const spawn = require('cross-spawn');
const ora = require('ora');
const logger = require('../lib/logger');
const { readProjectManifest } = require('../lib/project');

/**
 * Run the test script defined in the project's package.json.
 * @param {object} options
 * @param {string} options.dir    - Project root directory (default: cwd)
 * @param {boolean} options.silent - Suppress script output
 */
async function test({ dir = process.cwd(), silent = false } = {}) {
  logger.title('\n🧪  Imagia – Test');

  const pkg = readProjectManifest(dir);
  const scripts = pkg.scripts || {};

  if (!scripts.test) {
    logger.warn('No "test" script found in package.json. Skipping test step.');
    return { skipped: true };
  }

  logger.info(`Testing "${pkg.name || dir}" …`);
  const spinner = ora({ text: 'Running test suite…', isSilent: silent }).start();

  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'test'], {
      cwd: dir,
      stdio: silent ? 'pipe' : 'inherit',
      shell: false,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        spinner.succeed('All tests passed.');
        logger.success('Tests complete.');
        resolve({ exitCode: 0 });
      } else {
        spinner.fail('Tests failed.');
        logger.error(`Test script exited with code ${code}.`);
        reject(new Error(`Tests failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      spinner.fail('Test runner error.');
      reject(err);
    });
  });
}

module.exports = { test };
