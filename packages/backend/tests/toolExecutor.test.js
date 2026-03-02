// Mock codeValidatorService before requiring ToolExecutor
jest.mock('../src/services/codeValidatorService', () => ({
  validateChanges: jest.fn(() => ({ valid: true, errors: [], warnings: [] })),
}));

jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const ToolExecutor = require('../src/services/toolExecutor');
const codeValidatorService = require('../src/services/codeValidatorService');

describe('ToolExecutor', () => {
  const sampleFiles = [
    { path: 'src/App.jsx', content: 'export default function App() { return <div>Hello</div>; }', language: 'jsx' },
    { path: 'src/index.js', content: 'import App from "./App";\nReactDOM.render(<App />, root);', language: 'javascript' },
    { path: 'package.json', content: '{"name":"test","version":"1.0.0"}', language: 'json' },
  ];

  let executor;

  beforeEach(() => {
    jest.clearAllMocks();
    executor = new ToolExecutor(sampleFiles);
  });

  describe('constructor', () => {
    it('loads project files into in-memory map', () => {
      const manifest = executor.getFileManifest();
      expect(manifest).toHaveLength(3);
      expect(manifest).toContain('src/App.jsx');
      expect(manifest).toContain('src/index.js');
      expect(manifest).toContain('package.json');
    });

    it('returns sorted file manifest', () => {
      const manifest = executor.getFileManifest();
      const sorted = [...manifest].sort();
      expect(manifest).toEqual(sorted);
    });
  });

  describe('execute - read_files', () => {
    it('reads existing files', () => {
      const { result } = executor.execute('read_files', { paths: ['src/App.jsx'] });
      const parsed = JSON.parse(result);
      expect(parsed['src/App.jsx']).toContain('function App');
    });

    it('returns null for non-existent files', () => {
      const { result } = executor.execute('read_files', { paths: ['nonexistent.js'] });
      const parsed = JSON.parse(result);
      expect(parsed['nonexistent.js']).toBeNull();
    });

    it('reads multiple files at once', () => {
      const { result } = executor.execute('read_files', { paths: ['src/App.jsx', 'package.json'] });
      const parsed = JSON.parse(result);
      expect(Object.keys(parsed)).toHaveLength(2);
      expect(parsed['src/App.jsx']).toBeDefined();
      expect(parsed['package.json']).toBeDefined();
    });

    it('caps at 10 files per call', () => {
      const paths = Array.from({ length: 15 }, (_, i) => `file${i}.js`);
      const { result } = executor.execute('read_files', { paths });
      const parsed = JSON.parse(result);
      expect(Object.keys(parsed)).toHaveLength(10);
    });

    it('returns error for empty paths', () => {
      const { result } = executor.execute('read_files', { paths: [] });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });

    it('returns error for non-array paths', () => {
      const { result } = executor.execute('read_files', { paths: 'not-an-array' });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });
  });

  describe('execute - apply_changes', () => {
    it('modifies existing files', () => {
      const newContent = 'export default function App() { return <div>Updated</div>; }';
      const { result } = executor.execute('apply_changes', {
        files: [{ path: 'src/App.jsx', content: newContent, action: 'modify' }],
        summary: 'Updated App component',
      });

      const parsed = JSON.parse(result);
      expect(parsed.applied).toBe(1);
      expect(parsed.validation.valid).toBe(true);

      // Verify in-memory state updated
      const { result: readResult } = executor.execute('read_files', { paths: ['src/App.jsx'] });
      expect(JSON.parse(readResult)['src/App.jsx']).toBe(newContent);
    });

    it('creates new files', () => {
      const { result } = executor.execute('apply_changes', {
        files: [{ path: 'src/NewComponent.jsx', content: 'export default function New() {}', action: 'create' }],
        summary: 'Added new component',
      });

      const parsed = JSON.parse(result);
      expect(parsed.applied).toBe(1);

      const manifest = executor.getFileManifest();
      expect(manifest).toContain('src/NewComponent.jsx');
    });

    it('deletes files', () => {
      const { result } = executor.execute('apply_changes', {
        files: [{ path: 'src/App.jsx', action: 'delete' }],
        summary: 'Deleted App',
      });

      const parsed = JSON.parse(result);
      expect(parsed.applied).toBe(1);

      const manifest = executor.getFileManifest();
      expect(manifest).not.toContain('src/App.jsx');
    });

    it('tracks env vars needed', () => {
      executor.execute('apply_changes', {
        files: [{ path: 'src/config.js', content: 'const key = process.env.API_KEY;', action: 'create' }],
        summary: 'Added config',
        envVarsNeeded: ['API_KEY', 'API_SECRET'],
      });

      const results = executor.getResults();
      expect(results.envVarsNeeded).toContain('API_KEY');
      expect(results.envVarsNeeded).toContain('API_SECRET');
    });

    it('accumulates summaries from multiple calls', () => {
      executor.execute('apply_changes', {
        files: [{ path: 'a.js', content: 'a', action: 'create' }],
        summary: 'Created a',
      });
      executor.execute('apply_changes', {
        files: [{ path: 'b.js', content: 'b', action: 'create' }],
        summary: 'Created b',
      });

      const results = executor.getResults();
      expect(results.summary).toBe('Created a; Created b');
    });

    it('returns validation errors when they occur', () => {
      codeValidatorService.validateChanges.mockReturnValueOnce({
        valid: false,
        errors: [{ file: 'src/bad.js', line: 5, message: 'Syntax error', type: 'syntax' }],
        warnings: [],
      });

      const { result } = executor.execute('apply_changes', {
        files: [{ path: 'src/bad.js', content: 'const x = {;', action: 'modify' }],
        summary: 'Broke stuff',
      });

      const parsed = JSON.parse(result);
      expect(parsed.validation.valid).toBe(false);
      expect(parsed.validation.errors).toHaveLength(1);
      expect(parsed.validation.errors[0].message).toBe('Syntax error');
    });

    it('returns error for empty files array', () => {
      const { result } = executor.execute('apply_changes', {
        files: [],
        summary: 'Nothing',
      });
      const parsed = JSON.parse(result);
      expect(parsed.error).toBeDefined();
    });

    it('deduplicates changed files (last write wins)', () => {
      executor.execute('apply_changes', {
        files: [{ path: 'src/App.jsx', content: 'v1', action: 'modify' }],
        summary: 'First update',
      });
      executor.execute('apply_changes', {
        files: [{ path: 'src/App.jsx', content: 'v2', action: 'modify' }],
        summary: 'Second update',
      });

      const results = executor.getResults();
      const appFile = results.changedFiles.find(f => f.path === 'src/App.jsx');
      expect(appFile.content).toBe('v2');
    });
  });

  describe('execute - unknown tool', () => {
    it('returns error for unknown tool name', () => {
      const { result } = executor.execute('unknown_tool', {});
      const parsed = JSON.parse(result);
      expect(parsed.error).toContain('Unknown tool');
    });
  });

  describe('getResults', () => {
    it('returns empty results when no changes made', () => {
      const results = executor.getResults();
      expect(results.changedFiles).toHaveLength(0);
      expect(results.summary).toBe('');
      expect(results.envVarsNeeded).toHaveLength(0);
    });

    it('returns all changed files after modifications', () => {
      executor.execute('apply_changes', {
        files: [
          { path: 'src/App.jsx', content: 'updated', action: 'modify' },
          { path: 'src/new.js', content: 'new file', action: 'create' },
        ],
        summary: 'Updated app and added new file',
      });

      const results = executor.getResults();
      expect(results.changedFiles).toHaveLength(2);
      expect(results.changedFiles.map(f => f.path)).toContain('src/App.jsx');
      expect(results.changedFiles.map(f => f.path)).toContain('src/new.js');
    });
  });

  describe('language inference', () => {
    it('infers language from file extension', () => {
      executor.execute('apply_changes', {
        files: [{ path: 'styles/main.css', content: 'body { color: red; }', action: 'create' }],
        summary: 'Added CSS',
      });

      const results = executor.getResults();
      const cssFile = results.changedFiles.find(f => f.path === 'styles/main.css');
      expect(cssFile.language).toBe('css');
    });

    it('defaults to text for unknown extensions', () => {
      executor.execute('apply_changes', {
        files: [{ path: 'readme.txt', content: 'hello', action: 'create' }],
        summary: 'Added readme',
      });

      const results = executor.getResults();
      const txtFile = results.changedFiles.find(f => f.path === 'readme.txt');
      expect(txtFile.language).toBe('text');
    });
  });
});
