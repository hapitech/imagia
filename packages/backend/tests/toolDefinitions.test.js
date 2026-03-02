const { TOOL_DEFINITIONS, toAnthropicTools } = require('../src/utils/toolDefinitions');

describe('toolDefinitions', () => {
  describe('TOOL_DEFINITIONS', () => {
    it('exports an array of 2 tool definitions', () => {
      expect(Array.isArray(TOOL_DEFINITIONS)).toBe(true);
      expect(TOOL_DEFINITIONS).toHaveLength(2);
    });

    it('has read_files tool with correct schema', () => {
      const readFiles = TOOL_DEFINITIONS.find(t => t.function.name === 'read_files');
      expect(readFiles).toBeDefined();
      expect(readFiles.type).toBe('function');
      expect(readFiles.function.parameters.required).toContain('paths');
      expect(readFiles.function.parameters.properties.paths.type).toBe('array');
      expect(readFiles.function.parameters.properties.paths.maxItems).toBe(10);
    });

    it('has apply_changes tool with correct schema', () => {
      const applyChanges = TOOL_DEFINITIONS.find(t => t.function.name === 'apply_changes');
      expect(applyChanges).toBeDefined();
      expect(applyChanges.type).toBe('function');
      expect(applyChanges.function.parameters.required).toContain('files');
      expect(applyChanges.function.parameters.required).toContain('summary');

      const fileProps = applyChanges.function.parameters.properties.files.items.properties;
      expect(fileProps.path).toBeDefined();
      expect(fileProps.action.enum).toEqual(['create', 'modify', 'delete']);
    });
  });

  describe('toAnthropicTools', () => {
    it('converts OpenAI format to Anthropic format', () => {
      const anthropicTools = toAnthropicTools(TOOL_DEFINITIONS);

      expect(anthropicTools).toHaveLength(2);
      expect(anthropicTools[0]).toHaveProperty('name', 'read_files');
      expect(anthropicTools[0]).toHaveProperty('description');
      expect(anthropicTools[0]).toHaveProperty('input_schema');
      expect(anthropicTools[0]).not.toHaveProperty('type');
      expect(anthropicTools[0]).not.toHaveProperty('function');
    });

    it('preserves parameter schemas', () => {
      const anthropicTools = toAnthropicTools(TOOL_DEFINITIONS);
      const readFiles = anthropicTools.find(t => t.name === 'read_files');

      expect(readFiles.input_schema.properties.paths.type).toBe('array');
      expect(readFiles.input_schema.required).toContain('paths');
    });
  });
});
