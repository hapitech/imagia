'use strict';

const fs = require('fs-extra');
const path = require('path');

/**
 * Read and validate the project's package.json from the given directory.
 * @param {string} dir - Project root directory
 * @returns {{ name: string, version: string, description: string, scripts: object }}
 */
function readProjectManifest(dir) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    throw new Error(`No package.json found in ${dir}`);
  }
  const pkg = fs.readJsonSync(pkgPath);
  return pkg;
}

/**
 * Determine whether a directory looks like a supported project.
 * @param {string} dir
 * @returns {boolean}
 */
function isValidProject(dir) {
  return fs.existsSync(path.join(dir, 'package.json'));
}

module.exports = { readProjectManifest, isValidProject };
