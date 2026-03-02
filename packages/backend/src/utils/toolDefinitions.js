/**
 * Tool definitions for the tool-calling iteration agent.
 * Defined in OpenAI format (the base format); converted per-provider as needed.
 */

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'read_files',
      description:
        'Read the content of specific project files. Use this to understand existing code before making changes. ' +
        'You can read up to 10 files per call.',
      parameters: {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' },
            maxItems: 10,
            description: 'Array of file paths to read (relative to project root)',
          },
        },
        required: ['paths'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'apply_changes',
      description:
        'Write, modify, or delete project files. Each file is automatically validated (syntax, imports). ' +
        'If validation errors are found, they are returned so you can fix them in a follow-up call. ' +
        'Always read files before modifying them. Return complete file contents, not diffs.',
      parameters: {
        type: 'object',
        properties: {
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string', description: 'File path relative to project root' },
                content: { type: 'string', description: 'Complete file content (omit for delete)' },
                language: { type: 'string', description: 'Programming language (js, jsx, css, json, etc.)' },
                action: {
                  type: 'string',
                  enum: ['create', 'modify', 'delete'],
                  description: 'What to do with this file',
                },
              },
              required: ['path', 'action'],
            },
            description: 'Array of file changes to apply',
          },
          summary: {
            type: 'string',
            description: 'Brief summary of what these changes do',
          },
          envVarsNeeded: {
            type: 'array',
            items: { type: 'string' },
            description: 'Environment variable names needed by the changes (optional)',
          },
        },
        required: ['files', 'summary'],
      },
    },
  },
];

/**
 * Convert OpenAI-format tool definitions to Anthropic format.
 * OpenAI: { type:'function', function: { name, description, parameters } }
 * Anthropic: { name, description, input_schema }
 *
 * @param {Array} tools - Tool definitions in OpenAI format
 * @returns {Array} Tool definitions in Anthropic format
 */
function toAnthropicTools(tools) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

module.exports = { TOOL_DEFINITIONS, toAnthropicTools };
