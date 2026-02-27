/**
 * Prompt template for iterating on existing code based on user feedback.
 *
 * buildIterationPrompt - Sent to Claude when the user sends a follow-up message
 *                        requesting changes to an already-generated project.
 */

const ITERATION_SYSTEM_MESSAGE = `You are a senior software developer modifying an existing codebase based on user feedback. You are precise, careful, and conservative with changes.

Rules you MUST follow:
- Only modify files that actually need to change. Do NOT rewrite files that are unaffected.
- Preserve existing code structure, naming conventions, and patterns throughout the project.
- When adding a new feature, prefer creating new files over bloating existing ones.
- When modifying a file, return its COMPLETE new content — do not return diffs or partial snippets.
- Use environment variables (process.env.SECRET_NAME) for any new secrets or API keys. NEVER hardcode sensitive values.
- Maintain all existing imports and exports. If you remove a function, make sure no other file still imports it.
- Keep styling consistent with what is already in the project (Tailwind classes, CSS modules, etc.).
- For deleted files, include the file entry with action "delete" and no content.
- Provide a brief "summary" describing what you changed and why.
- If new environment variables are needed, list them in "envVarsNeeded".
- Your response MUST be valid JSON. Do NOT wrap it in markdown code fences. Do NOT include any explanatory text before or after the JSON.`;

/**
 * Build the prompt pair for iterating on existing project code.
 *
 * @param {string}   userMessage   - The user's change request / feedback.
 * @param {Array}    currentFiles  - Array of { path, content } for ALL current project files.
 * @param {Object}   requirements  - The parsed project requirements JSON from stage 1.
 * @param {string}   [contextMd]   - Optional project context markdown.
 * @returns {{ systemMessage: string, prompt: string, maxTokens: number, temperature: number }}
 */
function buildIterationPrompt(userMessage, currentFiles, requirements, contextMd) {
  const reqSummary = _buildRequirementsSummary(requirements);
  const currentFilesSection = _buildCurrentFilesSection(currentFiles);

  let prompt = `The user wants to modify an existing project. Apply their requested changes.

---
USER REQUEST:
${userMessage}
---

PROJECT REQUIREMENTS (for reference):
${reqSummary}
---

CURRENT PROJECT FILES:
${currentFilesSection}
---`;

  if (contextMd) {
    prompt += `

PROJECT CONTEXT:
${contextMd}
---`;
  }

  prompt += `

Return a JSON object with exactly this shape:

{
  "files": [
    {
      "path": "src/pages/Home.jsx",
      "content": "...full new file content...",
      "language": "jsx",
      "action": "modify"
    },
    {
      "path": "src/components/NewWidget.jsx",
      "content": "...full file content...",
      "language": "jsx",
      "action": "create"
    },
    {
      "path": "src/old-unused-file.js",
      "action": "delete"
    }
  ],
  "summary": "Brief description of all changes made.",
  "envVarsNeeded": ["NEW_API_KEY"]
}

Rules:
- "action" must be one of: "modify", "create", or "delete".
- For "modify" and "create" actions, include the FULL file content in "content" — not a diff.
- For "delete" actions, omit the "content" and "language" fields.
- Only include files that are changed, created, or deleted. Do NOT include unchanged files.
- "summary" must be a concise sentence or two explaining what was changed.
- "envVarsNeeded" should list any NEW environment variables required by the changes. Use an empty array if none are needed.
- Response MUST be valid JSON. No markdown fences. No commentary.`;

  return {
    systemMessage: ITERATION_SYSTEM_MESSAGE,
    prompt,
    maxTokens: 16000,
    temperature: 0.3,
  };
}

/**
 * Build a concise human-readable summary of the project requirements.
 * @private
 */
function _buildRequirementsSummary(requirements) {
  const lines = [
    `Name: ${requirements.name}`,
    `Description: ${requirements.description}`,
    `Framework: ${requirements.framework}`,
    `Styling: ${requirements.styling}`,
  ];

  if (requirements.features && requirements.features.length > 0) {
    lines.push(`Features: ${requirements.features.join(', ')}`);
  }

  if (requirements.pages && requirements.pages.length > 0) {
    lines.push('Pages:');
    for (const page of requirements.pages) {
      lines.push(`  - ${page.name} (${page.path}): ${page.description}`);
    }
  }

  if (requirements.dataModel && requirements.dataModel.length > 0) {
    lines.push('Data Models:');
    for (const model of requirements.dataModel) {
      lines.push(`  - ${model.name}: [${model.fields.join(', ')}]`);
    }
  }

  if (requirements.apiEndpoints && requirements.apiEndpoints.length > 0) {
    lines.push('API Endpoints:');
    for (const ep of requirements.apiEndpoints) {
      lines.push(`  - ${ep.method} ${ep.path}: ${ep.description}`);
    }
  }

  if (requirements.externalServices && requirements.externalServices.length > 0) {
    lines.push(`External Services: ${requirements.externalServices.join(', ')}`);
  }

  if (requirements.envVarsNeeded && requirements.envVarsNeeded.length > 0) {
    lines.push(`Environment Variables: ${requirements.envVarsNeeded.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Build the full listing of current project files with their complete content.
 * Unlike the code-generation prompt (which truncates), iteration needs full
 * file contents so the LLM can produce complete replacement files.
 * @private
 */
function _buildCurrentFilesSection(currentFiles) {
  if (!currentFiles || currentFiles.length === 0) {
    return '(no files in project)';
  }

  const sections = [];

  for (const file of currentFiles) {
    sections.push(`=== ${file.path} ===\n${file.content || '(empty file)'}`);
  }

  return sections.join('\n\n');
}

module.exports = {
  buildIterationPrompt,
};
