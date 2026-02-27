'use strict';

const spawn = require('cross-spawn');
const ora = require('ora');
const logger = require('../lib/logger');
const { readProjectManifest } = require('../lib/project');

/**
 * Run the build script defined in the project's package.json.
 * @param {object} options
 * @param {string} options.dir  - Project root directory (default: cwd)
 * @param {boolean} options.silent - Suppress script output
 */
async function build({ dir = process.cwd(), silent = false } = {}) {
  logger.title('\n🔨  Imagia – Build');

  const pkg = readProjectManifest(dir);
  const scripts = pkg.scripts || {};

  if (!scripts.build) {
    logger.warn('No "build" script found in package.json. Skipping build step.');
    return { skipped: true };
  }

  logger.info(`Building "${pkg.name || dir}" …`);
  const spinner = ora({ text: 'Running build script…', isSilent: silent }).start();

  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'build'], {
      cwd: dir,
      stdio: silent ? 'pipe' : 'inherit',
      shell: false,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        spinner.succeed('Build succeeded.');
        logger.success('Build complete.');
        resolve({ exitCode: 0 });
      } else {
        spinner.fail('Build failed.');
        logger.error(`Build script exited with code ${code}.`);
        reject(new Error(`Build failed with exit code ${code}`));
      }
    });

    proc.on('error', (err) => {
      spinner.fail('Build error.');
      reject(err);
    });
  });
}

module.exports = { build };
