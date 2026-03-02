/**
 * Integration tests for the tool-calling agent loop (iterateWithTools).
 *
 * These tests mock the LLM router to simulate different agent behaviors:
 * - Code change requests (read → apply_changes → summary)
 * - Question/research requests (read → text answer)
 * - Validation error auto-fix (apply_changes error → fix → success)
 * - Edge cases (timeout, context limit, no tool calls)
 */

// Mock external dependencies
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/services/cacheService', () => ({
  get: jest.fn(() => null),
  set: jest.fn(),
}));

jest.mock('../src/services/promptTracker', () => ({
  track: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/services/codeValidatorService', () => ({
  validateChanges: jest.fn(() => ({ valid: true, errors: [], warnings: [] })),
}));

// Mock llmRouter — the key mock
jest.mock('../src/services/llmRouter', () => ({
  routeWithTools: jest.fn(),
  route: jest.fn(),
  getProvider: jest.fn(),
}));

// Mock prompt builders (not needed for tool-calling tests)
jest.mock('../src/utils/prompts/appScaffold', () => ({
  buildRequirementsPrompt: jest.fn(),
  buildScaffoldPrompt: jest.fn(),
}));
jest.mock('../src/utils/prompts/codeGeneration', () => ({
  buildFileGenerationPrompt: jest.fn(),
  buildBatchFilePrompt: jest.fn(),
}));
jest.mock('../src/utils/prompts/codeIteration', () => ({
  buildIterationPrompt: jest.fn(),
}));
jest.mock('../src/utils/prompts/changeAnalysis', () => ({
  buildChangeAnalysisPrompt: jest.fn(),
  buildChangePlanPrompt: jest.fn(),
}));
jest.mock('../src/utils/prompts/codeFix', () => ({
  buildCodeFixPrompt: jest.fn(),
}));

const codeGeneratorService = require('../src/services/codeGeneratorService');
const llmRouter = require('../src/services/llmRouter');
const codeValidatorService = require('../src/services/codeValidatorService');

// Helper to create a mock LLM response
function mockLLMResponse({ content = '', toolCalls = [], finishReason = 'stop', tokens = 100 }) {
  return {
    message: {
      role: 'assistant',
      content,
      toolCalls,
    },
    usage: {
      inputTokens: tokens,
      outputTokens: tokens,
      totalTokens: tokens * 2,
    },
    model: 'test-model',
    finishReason,
    provider: 'fireworks',
    fallbackUsed: false,
  };
}

const sampleProjectFiles = [
  { path: 'src/App.jsx', content: 'export default function App() { return <div>Hello World</div>; }', language: 'jsx' },
  { path: 'src/index.js', content: 'import App from "./App";\nReactDOM.render(<App />, document.getElementById("root"));', language: 'javascript' },
  { path: 'src/styles.css', content: 'body { margin: 0; font-family: sans-serif; }', language: 'css' },
  { path: 'package.json', content: '{"name":"test-app","version":"1.0.0","dependencies":{"react":"^18.0.0"}}', language: 'json' },
];

const defaultOptions = {
  projectId: 'test-project-id',
  userId: 'test-user-id',
  correlationId: 'test-correlation-id',
};

describe('iterateWithTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('code change requests', () => {
    it('handles a simple read → apply_changes → summary flow', async () => {
      // Turn 1: LLM calls read_files
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-1',
            name: 'read_files',
            arguments: { paths: ['src/App.jsx'] },
          }],
          finishReason: 'tool_calls',
        }))
        // Turn 2: LLM calls apply_changes
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-2',
            name: 'apply_changes',
            arguments: {
              files: [{
                path: 'src/App.jsx',
                content: 'export default function App() { return <div>Updated!</div>; }',
                action: 'modify',
              }],
              summary: 'Updated the heading text',
            },
          }],
          finishReason: 'tool_calls',
        }))
        // Turn 3: LLM responds with text summary (done)
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'I updated the App component heading from "Hello World" to "Updated!".',
          finishReason: 'stop',
        }));

      const result = await codeGeneratorService.iterateWithTools(
        'Change the heading to "Updated!"',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      expect(result.changedFiles).toHaveLength(1);
      expect(result.changedFiles[0].path).toBe('src/App.jsx');
      expect(result.changedFiles[0].content).toContain('Updated!');
      expect(result.summary).toBe('Updated the heading text');
      expect(result.agentResponse).toBe('I updated the App component heading from "Hello World" to "Updated!".');
      expect(result.turnCount).toBe(3);
      expect(result.tokenUsage.totalTokens).toBeGreaterThan(0);
    });

    it('handles multiple file changes', async () => {
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-1',
            name: 'read_files',
            arguments: { paths: ['src/App.jsx', 'src/styles.css'] },
          }],
          finishReason: 'tool_calls',
        }))
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-2',
            name: 'apply_changes',
            arguments: {
              files: [
                { path: 'src/App.jsx', content: 'updated jsx', action: 'modify' },
                { path: 'src/styles.css', content: 'updated css', action: 'modify' },
                { path: 'src/Header.jsx', content: 'new header', action: 'create' },
              ],
              summary: 'Added header component and updated styles',
            },
          }],
          finishReason: 'tool_calls',
        }))
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Done! I added a Header component and updated the styles.',
          finishReason: 'stop',
        }));

      const result = await codeGeneratorService.iterateWithTools(
        'Add a header component',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      expect(result.changedFiles).toHaveLength(3);
      expect(result.changedFiles.map(f => f.path)).toContain('src/Header.jsx');
    });

    it('handles file deletion', async () => {
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-1',
            name: 'apply_changes',
            arguments: {
              files: [{ path: 'src/styles.css', action: 'delete' }],
              summary: 'Removed styles.css',
            },
          }],
          finishReason: 'tool_calls',
        }))
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Deleted the styles.css file.',
          finishReason: 'stop',
        }));

      const result = await codeGeneratorService.iterateWithTools(
        'Delete styles.css',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      expect(result.changedFiles).toHaveLength(1);
      expect(result.changedFiles[0].action).toBe('delete');
    });
  });

  describe('question/research requests (no code changes)', () => {
    it('returns agent text response when user asks a question', async () => {
      // Turn 1: LLM reads files to understand them
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-1',
            name: 'read_files',
            arguments: { paths: ['src/App.jsx', 'src/index.js'] },
          }],
          finishReason: 'tool_calls',
        }))
        // Turn 2: LLM responds with a detailed answer (no apply_changes)
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'The App component renders a simple "Hello World" div. It is imported in index.js and rendered into the root DOM element using ReactDOM.render().',
          finishReason: 'stop',
        }));

      const result = await codeGeneratorService.iterateWithTools(
        'Give me a summary of how the app works',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      // No files changed
      expect(result.changedFiles).toHaveLength(0);
      // But agent response should be captured
      expect(result.agentResponse).toBe('The App component renders a simple "Hello World" div. It is imported in index.js and rendered into the root DOM element using ReactDOM.render().');
      expect(result.summary).toBe(''); // No apply_changes summaries
      expect(result.turnCount).toBe(2);
    });

    it('returns agent response when LLM answers directly without tools', async () => {
      // LLM responds immediately with text (no tool calls at all)
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'This is a React application with 4 files. The main component is App.jsx.',
          finishReason: 'stop',
        }));

      const result = await codeGeneratorService.iterateWithTools(
        'How many files are in this project?',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      expect(result.changedFiles).toHaveLength(0);
      expect(result.agentResponse).toBe('This is a React application with 4 files. The main component is App.jsx.');
      expect(result.turnCount).toBe(1);
    });

    it('captures the LAST text response from the agent', async () => {
      // Turn 1: LLM reads files (with some thinking text)
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Let me check the files...',
          toolCalls: [{
            id: 'call-1',
            name: 'read_files',
            arguments: { paths: ['src/App.jsx'] },
          }],
          finishReason: 'tool_calls',
        }))
        // Turn 2: LLM responds with final answer
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'The App component uses a functional component pattern with JSX.',
          finishReason: 'stop',
        }));

      const result = await codeGeneratorService.iterateWithTools(
        'What pattern does App.jsx use?',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      // Should capture the last response, not the intermediate one
      expect(result.agentResponse).toBe('The App component uses a functional component pattern with JSX.');
    });
  });

  describe('validation error auto-fix', () => {
    it('handles validation errors and auto-fix cycle', async () => {
      // Set up validator to fail first, pass second
      codeValidatorService.validateChanges
        .mockReturnValueOnce({
          valid: false,
          errors: [{ file: 'src/App.jsx', line: 1, message: 'Unexpected token', type: 'syntax' }],
          warnings: [],
        })
        .mockReturnValueOnce({
          valid: true,
          errors: [],
          warnings: [],
        });

      llmRouter.routeWithTools
        // Turn 1: LLM reads file
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-1',
            name: 'read_files',
            arguments: { paths: ['src/App.jsx'] },
          }],
          finishReason: 'tool_calls',
        }))
        // Turn 2: LLM applies changes (will fail validation)
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-2',
            name: 'apply_changes',
            arguments: {
              files: [{ path: 'src/App.jsx', content: 'bad code {;', action: 'modify' }],
              summary: 'Attempted update',
            },
          }],
          finishReason: 'tool_calls',
        }))
        // Turn 3: LLM sees error, applies fix
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-3',
            name: 'apply_changes',
            arguments: {
              files: [{ path: 'src/App.jsx', content: 'export default function App() { return <div>Fixed</div>; }', action: 'modify' }],
              summary: 'Fixed syntax error',
            },
          }],
          finishReason: 'tool_calls',
        }))
        // Turn 4: Done
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Fixed the syntax error and updated the component.',
          finishReason: 'stop',
        }));

      const result = await codeGeneratorService.iterateWithTools(
        'Update the app',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      expect(result.changedFiles).toHaveLength(1);
      expect(result.changedFiles[0].content).toContain('Fixed');
      expect(result.turnCount).toBe(4);
      expect(result.agentResponse).toBe('Fixed the syntax error and updated the component.');
    });
  });

  describe('edge cases', () => {
    it('handles env vars needed', async () => {
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-1',
            name: 'apply_changes',
            arguments: {
              files: [{ path: 'src/config.js', content: 'const key = process.env.API_KEY;', action: 'create' }],
              summary: 'Added config file',
              envVarsNeeded: ['API_KEY'],
            },
          }],
          finishReason: 'tool_calls',
        }))
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Added config file. You will need to set the API_KEY environment variable.',
          finishReason: 'stop',
        }));

      const result = await codeGeneratorService.iterateWithTools(
        'Add a config file',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      expect(result.envVarsNeeded).toContain('API_KEY');
    });

    it('invokes progress callback for each tool call', async () => {
      const progressCallback = jest.fn();

      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{
            id: 'call-1',
            name: 'read_files',
            arguments: { paths: ['src/App.jsx'] },
          }],
          finishReason: 'tool_calls',
        }))
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Done reading.',
          finishReason: 'stop',
        }));

      await codeGeneratorService.iterateWithTools(
        'Read the app',
        sampleProjectFiles,
        '',
        defaultOptions,
        progressCallback,
      );

      expect(progressCallback).toHaveBeenCalledWith({
        type: 'read_files',
        detail: expect.stringContaining('Reading'),
      });
    });

    it('accumulates token usage across turns', async () => {
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          toolCalls: [{ id: 'call-1', name: 'read_files', arguments: { paths: ['src/App.jsx'] } }],
          finishReason: 'tool_calls',
          tokens: 500,
        }))
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Done.',
          finishReason: 'stop',
          tokens: 300,
        }));

      const result = await codeGeneratorService.iterateWithTools(
        'Read app',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      expect(result.tokenUsage.inputTokens).toBe(800);
      expect(result.tokenUsage.outputTokens).toBe(800);
      expect(result.tokenUsage.totalTokens).toBe(1600);
    });

    it('includes context in system prompt when provided', async () => {
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Analyzed with context.',
          finishReason: 'stop',
        }));

      await codeGeneratorService.iterateWithTools(
        'Analyze this',
        sampleProjectFiles,
        '## Context\nThis is a React counter app.',
        defaultOptions,
      );

      // Check system prompt includes context
      const callArgs = llmRouter.routeWithTools.mock.calls[0][1];
      const systemMsg = callArgs.messages.find(m => m.role === 'system');
      expect(systemMsg.content).toContain('## Project Context');
      expect(systemMsg.content).toContain('React counter app');
    });

    it('includes file manifest in system prompt', async () => {
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Done.',
          finishReason: 'stop',
        }));

      await codeGeneratorService.iterateWithTools(
        'Check files',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      const callArgs = llmRouter.routeWithTools.mock.calls[0][1];
      const systemMsg = callArgs.messages.find(m => m.role === 'system');
      expect(systemMsg.content).toContain('src/App.jsx');
      expect(systemMsg.content).toContain('package.json');
    });
  });

  describe('system prompt', () => {
    it('tells the LLM to handle both code changes and questions', async () => {
      llmRouter.routeWithTools
        .mockResolvedValueOnce(mockLLMResponse({
          content: 'Done.',
          finishReason: 'stop',
        }));

      await codeGeneratorService.iterateWithTools(
        'Test',
        sampleProjectFiles,
        '',
        defaultOptions,
      );

      const callArgs = llmRouter.routeWithTools.mock.calls[0][1];
      const systemMsg = callArgs.messages.find(m => m.role === 'system');

      // Should mention both code changes AND questions
      expect(systemMsg.content).toContain('change');
      expect(systemMsg.content).toContain('question');
      // Should NOT force apply_changes
      expect(systemMsg.content).not.toContain('You MUST use the provided tools to make changes');
    });
  });
});
