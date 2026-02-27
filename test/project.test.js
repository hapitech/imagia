'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { readProjectManifest, isValidProject } = require('../src/lib/project');

describe('readProjectManifest()', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imagia-proj-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('reads a valid package.json', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'test', version: '1.0.0' });
    const pkg = readProjectManifest(tmpDir);
    expect(pkg.name).toBe('test');
    expect(pkg.version).toBe('1.0.0');
  });

  it('throws when package.json is missing', () => {
    expect(() => readProjectManifest(tmpDir)).toThrow('No package.json');
  });
});

describe('isValidProject()', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imagia-valid-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('returns true when package.json exists', async () => {
    await fs.writeJson(path.join(tmpDir, 'package.json'), {});
    expect(isValidProject(tmpDir)).toBe(true);
  });

  it('returns false when package.json is absent', () => {
    expect(isValidProject(tmpDir)).toBe(false);
  });
});
