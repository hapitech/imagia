#!/usr/bin/env node
'use strict';

const { Command } = require('commander');
const logger = require('./src/lib/logger');
const { build } = require('./src/commands/build');
const { test } = require('./src/commands/test');
const { deploy, TARGETS } = require('./src/commands/deploy');
const { market } = require('./src/commands/market');

const pkg = require('./package.json');

const program = new Command();

program
  .name('imagia')
  .description('Build what you can imagine – build, test, deploy and market your app')
  .version(pkg.version);

// ─── build ──────────────────────────────────────────────────────────────────
program
  .command('build')
  .description('Build the application (runs the "build" npm script)')
  .option('-d, --dir <path>', 'Project root directory', process.cwd())
  .action(async (opts) => {
    try {
      await build({ dir: opts.dir });
    } catch (err) {
      logger.error(err.message);
      process.exitCode = 1;
    }
  });

// ─── test ───────────────────────────────────────────────────────────────────
program
  .command('test')
  .description('Run the test suite (runs the "test" npm script)')
  .option('-d, --dir <path>', 'Project root directory', process.cwd())
  .action(async (opts) => {
    try {
      await test({ dir: opts.dir });
    } catch (err) {
      logger.error(err.message);
      process.exitCode = 1;
    }
  });

// ─── deploy ─────────────────────────────────────────────────────────────────
program
  .command('deploy')
  .description(`Deploy the application (targets: ${TARGETS.join(', ')})`)
  .option('-d, --dir <path>', 'Project root directory', process.cwd())
  .option('-t, --target <target>', 'Deploy target (local | docker | custom)', 'local')
  .option('--cmd <command>', 'Command to run for the "custom" deploy target')
  .action(async (opts) => {
    try {
      await deploy({ dir: opts.dir, target: opts.target, customCmd: opts.cmd });
    } catch (err) {
      logger.error(err.message);
      process.exitCode = 1;
    }
  });

// ─── market ─────────────────────────────────────────────────────────────────
program
  .command('market')
  .description(
    'Generate marketing collateral (MARKETING_README.md, preview.html, social.txt)'
  )
  .option('-d, --dir <path>', 'Project root directory', process.cwd())
  .action(async (opts) => {
    try {
      const result = await market({ dir: opts.dir });
      logger.success(`\nAssets written to: ${result.outDir}`);
    } catch (err) {
      logger.error(err.message);
      process.exitCode = 1;
    }
  });

program.parse(process.argv);
