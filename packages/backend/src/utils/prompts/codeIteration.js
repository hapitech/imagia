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
 * Rough char-to-token ratio. ~4 chars per token for English/code is a
 * widely-used heuristic. We use it to stay under model context limits.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Max input tokens to reserve for the current-files section.
 * GPT-4o has 128k context. We leave ~20k for system prompt, user message,
 * requirements summary, context.md, and the response format instructions,
 * plus ~16k for max_tokens output → budget ≈ 90k tokens for files.
 */
const MAX_FILES_TOKENS = 90000;
const MAX_FILES_CHARS = MAX_FILES_TOKENS * CHARS_PER_TOKEN; // ~360k chars

/**
 * Build the full listing of current project files with their complete content.
 * If the total content exceeds the character budget, files are prioritised by
 * relevance and truncated:
 *   1. Config files (package.json, index.html, etc.) — always included
 *   2. Smaller source files — included in full
 *   3. Larger source files — content truncated with a "…truncated" marker
 *   4. If still over budget, remaining files listed as names only
 * @private
 */
function _buildCurrentFilesSection(currentFiles) {
  if (!currentFiles || currentFiles.length === 0) {
    return '(no files in project)';
  }

  // Sort: config/entry files first, then by size ascending (smaller = more likely to fit)
  const CONFIG_PATTERNS = /^(package\.json|index\.html|vite\.config|tsconfig|tailwind\.config|postcss\.config|\.env)/i;
  const sorted = [...currentFiles].sort((a, b) => {
    const aConfig = CONFIG_PATTERNS.test(a.path.split('/').pop()) ? 0 : 1;
    const bConfig = CONFIG_PATTERNS.test(b.path.split('/').pop()) ? 0 : 1;
    if (aConfig !== bConfig) return aConfig - bConfig;
    return (a.content || '').length - (b.content || '').length;
  });

  const sections = [];
  let charBudget = MAX_FILES_CHARS;
  let truncatedCount = 0;
  let skippedFiles = [];

  for (const file of sorted) {
    const content = file.content || '(empty file)';
    const header = `=== ${file.path} ===\n`;
    const fullEntry = header + content;

    if (charBudget <= 0) {
      // No budget left — just record the file name
      skippedFiles.push(file.path);
      continue;
    }

    if (fullEntry.length <= charBudget) {
      // Fits entirely
      sections.push(fullEntry);
      charBudget -= fullEntry.length + 2; // +2 for join separator
    } else if (charBudget > header.length + 200) {
      // Partially fits — truncate content
      const availableChars = charBudget - header.length - 60; // room for truncation marker
      const truncatedContent = content.slice(0, Math.max(availableChars, 200));
      sections.push(header + truncatedContent + '\n... (truncated — file has ' + content.length + ' chars)');
      charBudget = 0;
      truncatedCount++;
    } else {
      // Not enough room even for a truncated version
      skippedFiles.push(file.path);
    }
  }

  if (skippedFiles.length > 0 || truncatedCount > 0) {
    let note = `\n\n[Note: ${currentFiles.length} total files in project.`;
    if (truncatedCount > 0) note += ` ${truncatedCount} file(s) truncated.`;
    if (skippedFiles.length > 0) note += ` ${skippedFiles.length} file(s) omitted for brevity: ${skippedFiles.join(', ')}`;
    note += ' — Only modify files you can see in full above.]';
    sections.push(note);
  }

  return sections.join('\n\n');
}

module.exports = {
  buildIterationPrompt,
};
