'use strict';

const spawn = require('cross-spawn');
const path = require('path');
const fs = require('fs-extra');
const ora = require('ora');
const logger = require('../lib/logger');
const { readProjectManifest } = require('../lib/project');

/**
 * Supported deploy targets.
 */
const TARGETS = ['local', 'docker', 'custom'];

/**
 * Deploy the project.
 *
 * - target "local"  : runs `npm run deploy` if defined, otherwise packs the project into a tarball.
 * - target "docker" : builds a Docker image (requires Dockerfile in project root).
 * - target "custom" : runs an arbitrary deploy command supplied via options.customCmd.
 *
 * @param {object} options
 * @param {string} options.dir         - Project root directory (default: cwd)
 * @param {string} options.target      - One of TARGETS (default: "local")
 * @param {string} [options.customCmd] - Command to run when target is "custom"
 * @param {boolean} options.silent     - Suppress script output
 */
async function deploy({
  dir = process.cwd(),
  target = 'local',
  customCmd,
  silent = false,
} = {}) {
  logger.title('\n🚀  Imagia – Deploy');

  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown deploy target "${target}". Supported: ${TARGETS.join(', ')}`);
  }

  const pkg = readProjectManifest(dir);
  const appName = pkg.name || path.basename(dir);
  logger.info(`Deploying "${appName}" (target: ${target}) …`);

  const spinner = ora({ text: 'Deploying…', isSilent: silent }).start();

  try {
    if (target === 'docker') {
      await _deployDocker({ dir, appName, pkg, silent, spinner });
    } else if (target === 'custom') {
      await _deployCustom({ dir, customCmd, silent, spinner });
    } else {
      await _deployLocal({ dir, pkg, appName, silent, spinner });
    }
  } catch (err) {
    spinner.fail('Deployment failed.');
    throw err;
  }

  logger.success(`Deployment complete (target: ${target}).`);
  return { target, appName };
}

async function _deployLocal({ dir, pkg, appName, silent, spinner }) {
  const scripts = pkg.scripts || {};

  if (scripts.deploy) {
    spinner.text = 'Running deploy script…';
    await _runScript({ cwd: dir, script: 'deploy', silent });
    spinner.succeed('Deploy script finished.');
    return;
  }

  // Fallback: create an npm pack tarball in the project directory
  spinner.text = 'Creating deployment package (npm pack)…';
  await _runCommand('npm', ['pack', '--pack-destination', dir], dir, silent);
  spinner.succeed(`Package created in ${dir}`);
}

async function _deployDocker({ dir, appName, pkg, silent, spinner }) {
  const dockerfilePath = path.join(dir, 'Dockerfile');
  if (!fs.existsSync(dockerfilePath)) {
    throw new Error('No Dockerfile found in project root. Cannot deploy with docker target.');
  }
  const tag = `${appName}:${pkg.version || 'latest'}`;
  spinner.text = `Building Docker image ${tag}…`;
  await _runCommand('docker', ['build', '-t', tag, '.'], dir, silent);
  spinner.succeed(`Docker image built: ${tag}`);
}

async function _deployCustom({ dir, customCmd, silent, spinner }) {
  if (!customCmd) {
    throw new Error('No --cmd supplied for custom deploy target.');
  }
  spinner.text = `Running custom deploy: ${customCmd}…`;
  await _runCommand('sh', ['-c', customCmd], dir, silent);
  spinner.succeed('Custom deploy command finished.');
}

function _runScript({ cwd, script, silent }) {
  return _runCommand('npm', ['run', script], cwd, silent);
}

function _runCommand(cmd, args, cwd, silent) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: silent ? 'pipe' : 'inherit',
      shell: false,
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`"${cmd} ${args.join(' ')}" exited with code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

module.exports = { deploy, TARGETS };
