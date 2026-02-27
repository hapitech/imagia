'use strict';

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { market, extractFeatures, buildContext, MARKETING_DIR } = require('../src/commands/market');

// ---------------------------------------------------------------------------
// extractFeatures
// ---------------------------------------------------------------------------
describe('extractFeatures()', () => {
  it('returns pkg.imagia.features when present', () => {
    const pkg = { imagia: { features: ['Fast', 'Reliable'] } };
    expect(extractFeatures(pkg)).toEqual(['Fast', 'Reliable']);
  });

  it('capitalizes keywords when imagia.features is absent', () => {
    const pkg = { keywords: ['fast', 'reliable'] };
    expect(extractFeatures(pkg)).toEqual(['Fast', 'Reliable']);
  });

  it('returns default features when neither imagia.features nor keywords exist', () => {
    const features = extractFeatures({});
    expect(features.length).toBeGreaterThan(0);
    features.forEach((f) => expect(typeof f).toBe('string'));
  });
});

// ---------------------------------------------------------------------------
// buildContext
// ---------------------------------------------------------------------------
describe('buildContext()', () => {
  it('maps all package fields into the template context', () => {
    const pkg = {
      name: 'my-app',
      version: '2.0.0',
      description: 'An example app',
      license: 'MIT',
      homepage: 'https://example.com',
      keywords: ['example'],
    };
    const ctx = buildContext(pkg);
    expect(ctx.name).toBe('my-app');
    expect(ctx.version).toBe('2.0.0');
    expect(ctx.description).toBe('An example app');
    expect(ctx.license).toBe('MIT');
    expect(ctx.homepage).toBe('https://example.com');
    expect(ctx.features).toEqual(['Example']);
    expect(typeof ctx.generatedAt).toBe('string');
  });

  it('uses sensible defaults for missing fields', () => {
    const ctx = buildContext({});
    expect(ctx.name).toBe('my-app');
    expect(ctx.version).toBe('1.0.0');
    expect(ctx.description).toBe('An awesome application');
    expect(ctx.license).toBe('ISC');
    expect(ctx.homepage).toBe('');
  });
});

// ---------------------------------------------------------------------------
// market() – integration (writes real files)
// ---------------------------------------------------------------------------
describe('market()', () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imagia-test-'));
    await fs.writeJson(path.join(tmpDir, 'package.json'), {
      name: 'demo-app',
      version: '0.1.0',
      description: 'Demo application',
      keywords: ['demo', 'test'],
      license: 'MIT',
    });
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('creates the marketing directory and expected files', async () => {
    const result = await market({ dir: tmpDir, silent: true });

    expect(result.outDir).toBe(path.join(tmpDir, MARKETING_DIR));
    expect(result.files).toHaveLength(3);

    for (const f of result.files) {
      expect(await fs.pathExists(f)).toBe(true);
    }
  });

  it('generates a MARKETING_README.md that contains the app name', async () => {
    await market({ dir: tmpDir, silent: true });
    const readme = await fs.readFile(
      path.join(tmpDir, MARKETING_DIR, 'MARKETING_README.md'),
      'utf8'
    );
    expect(readme).toContain('demo-app');
    expect(readme).toContain('Demo application');
  });

  it('generates a valid preview.html page', async () => {
    await market({ dir: tmpDir, silent: true });
    const html = await fs.readFile(path.join(tmpDir, MARKETING_DIR, 'preview.html'), 'utf8');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('demo-app');
    expect(html).toContain('0.1.0');
  });

  it('generates a social.txt snippet', async () => {
    await market({ dir: tmpDir, silent: true });
    const social = await fs.readFile(path.join(tmpDir, MARKETING_DIR, 'social.txt'), 'utf8');
    expect(social).toContain('demo-app');
    expect(social).toContain('#builtwithimagia');
  });

  it('throws when no package.json is present', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'imagia-empty-'));
    try {
      await expect(market({ dir: emptyDir, silent: true })).rejects.toThrow('No package.json');
    } finally {
      await fs.remove(emptyDir);
    }
  });
});
