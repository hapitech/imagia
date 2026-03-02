/**
 * Tests for appBuilderService response handling in iterateFromMessage.
 * Focuses on how the agent's text response flows through to the user
 * for both code-change and question/research/summary scenarios.
 */

// Mock all external dependencies
jest.mock('../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/config/database', () => {
  const mockUpdate = jest.fn(() => Promise.resolve());
  const mockWhere = jest.fn(() => ({ update: mockUpdate, delete: jest.fn(() => Promise.resolve()), count: jest.fn(() => ({ first: jest.fn(() => ({ count: '0' })) })) }));
  const mockInsert = jest.fn(() => Promise.resolve());
  const mockDb = jest.fn((table) => ({
    where: mockWhere,
    insert: mockInsert,
    count: jest.fn(() => ({ first: jest.fn(() => ({ count: '0' })) })),
  }));
  mockDb.fn = { now: jest.fn(() => new Date()) };
  return { db: mockDb };
});

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

jest.mock('../src/services/llmRouter', () => ({
  routeWithTools: jest.fn(),
  route: jest.fn(),
  getProvider: jest.fn(),
}));

jest.mock('../src/services/contextService', () => ({
  getContext: jest.fn(() => Promise.resolve('')),
  buildContextFromHistory: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/queues/progressEmitter', () => ({
  emit: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/utils/contentHash', () => ({
  generateContentHash: jest.fn(() => 'hash123'),
  llmCacheKey: jest.fn(() => 'cache-key'),
}));

// Mock prompt builders
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

const { db } = require('../src/config/database');
const llmRouter = require('../src/services/llmRouter');
const AppBuilderService = require('../src/services/appBuilderService');
const progressEmitter = require('../src/queues/progressEmitter');

function mockLLMResponse({ content = '', toolCalls = [], finishReason = 'stop', tokens = 100 }) {
  return {
    message: { role: 'assistant', content, toolCalls },
    usage: { inputTokens: tokens, outputTokens: tokens, totalTokens: tokens * 2 },
    model: 'test-model',
    finishReason,
    provider: 'fireworks',
    fallbackUsed: false,
  };
}

describe('AppBuilderService - iterateFromMessage response handling', () => {
  let appBuilder;
  let storedMessages;

  beforeEach(() => {
    jest.clearAllMocks();
    storedMessages = [];

    // Create a fresh instance
    appBuilder = new (Object.getPrototypeOf(AppBuilderService).constructor || AppBuilderService.constructor)();

    // For the class to work, we need the methods. Since it's a singleton,
    // we'll test the module directly
    appBuilder = AppBuilderService;

    // Mock _getUserMessage
    appBuilder._getUserMessage = jest.fn(() => Promise.resolve('Test user message'));

    // Mock _getProjectFiles to return sample files
    appBuilder._getProjectFiles = jest.fn(() => Promise.resolve([
      { path: 'src/App.jsx', content: 'export default function App() { return <div>Hello</div>; }', language: 'jsx' },
      { path: 'package.json', content: '{"name":"test"}', language: 'json' },
    ]));

    // Mock _getProjectSettings
    appBuilder._getProjectSettings = jest.fn(() => Promise.resolve({ requirements: {} }));

    // Mock _storeAssistantMessage to capture what's stored
    appBuilder._storeAssistantMessage = jest.fn((convId, message, metadata) => {
      storedMessages.push({ convId, message, metadata });
      return Promise.resolve();
    });

    // Mock _saveFile
    appBuilder._saveFile = jest.fn(() => Promise.resolve());

    // Mock _getNextVersionNumber
    appBuilder._getNextVersionNumber = jest.fn(() => Promise.resolve(1));

    // Mock _appendEnvVars
    appBuilder._appendEnvVars = jest.fn(() => Promise.resolve());

    // Mock _supportsToolCalling
    appBuilder._supportsToolCalling = jest.fn(() => true);
  });

  it('passes agent text response when no files changed (question scenario)', async () => {
    // LLM reads files then answers with text
    llmRouter.routeWithTools
      .mockResolvedValueOnce(mockLLMResponse({
        toolCalls: [{ id: 'call-1', name: 'read_files', arguments: { paths: ['src/App.jsx'] } }],
        finishReason: 'tool_calls',
      }))
      .mockResolvedValueOnce(mockLLMResponse({
        content: 'The App component renders a Hello div using a functional component pattern. It exports as the default export.',
        finishReason: 'stop',
      }));

    const result = await appBuilder.iterateFromMessage({
      projectId: 'test-project',
      conversationId: 'test-conv',
      messageId: 'test-msg',
      userId: 'test-user',
      correlationId: 'test-corr',
    });

    expect(result.success).toBe(true);
    expect(result.filesChanged).toBe(0);

    // The stored message should be the agent's text, NOT the generic fallback
    expect(storedMessages).toHaveLength(1);
    expect(storedMessages[0].message).toContain('App component renders');
    expect(storedMessages[0].message).not.toContain('no file changes were needed');
    expect(storedMessages[0].message).not.toContain('I reviewed your project but');
  });

  it('uses apply_changes summary when files were changed', async () => {
    llmRouter.routeWithTools
      .mockResolvedValueOnce(mockLLMResponse({
        toolCalls: [{
          id: 'call-1',
          name: 'apply_changes',
          arguments: {
            files: [{ path: 'src/App.jsx', content: 'updated content', action: 'modify' }],
            summary: 'Updated App component',
          },
        }],
        finishReason: 'tool_calls',
      }))
      .mockResolvedValueOnce(mockLLMResponse({
        content: 'I updated the App component as requested.',
        finishReason: 'stop',
      }));

    const result = await appBuilder.iterateFromMessage({
      projectId: 'test-project',
      conversationId: 'test-conv',
      messageId: 'test-msg',
      userId: 'test-user',
      correlationId: 'test-corr',
    });

    expect(result.success).toBe(true);
    expect(result.filesChanged).toBe(1);

    // The stored message for code changes uses the summary format
    expect(storedMessages).toHaveLength(1);
    expect(storedMessages[0].message).toContain('Updated App component');
  });

  it('uses fallback message when neither agentResponse nor summary available', async () => {
    // LLM responds with no content and no tool calls
    llmRouter.routeWithTools
      .mockResolvedValueOnce(mockLLMResponse({
        content: '',
        finishReason: 'stop',
      }));

    const result = await appBuilder.iterateFromMessage({
      projectId: 'test-project',
      conversationId: 'test-conv',
      messageId: 'test-msg',
      userId: 'test-user',
      correlationId: 'test-corr',
    });

    expect(result.success).toBe(true);
    expect(result.filesChanged).toBe(0);

    // Should use the improved fallback (not the old generic one)
    expect(storedMessages).toHaveLength(1);
    expect(storedMessages[0].message).not.toContain('no file changes were needed');
  });
});
