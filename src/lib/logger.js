'use strict';

const chalk = require('chalk');

const logger = {
  info: (msg) => console.log(chalk.blue('ℹ'), msg),
  success: (msg) => console.log(chalk.green('✔'), msg),
  warn: (msg) => console.log(chalk.yellow('⚠'), msg),
  error: (msg) => console.error(chalk.red('✖'), msg),
  title: (msg) => console.log(chalk.bold.cyan(msg)),
};

module.exports = logger;
