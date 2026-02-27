/**
 * Prompt templates for Stage 3 (Generate Core Application Code).
 *
 * buildFileGenerationPrompt - Sent to Claude to generate a single source file,
 *                             given the project requirements and already-generated files
 *                             for cross-reference.
 * buildBatchFilePrompt      - Sent to Claude to generate multiple source files in one
 *                             request, returning them as a JSON array.
 */

const MAX_EXISTING_FILE_LINES = 200;

const SINGLE_FILE_SYSTEM_MESSAGE = `You are a senior full-stack developer writing production-quality code for a web application. You write clean, well-structured, and maintainable code.

Rules you MUST follow:
- Use the framework and styling system specified in the project requirements.
- Import modules using correct relative paths based on the project's file structure.
- Use environment variables (process.env.SECRET_NAME) for ALL secrets and API keys. NEVER hardcode sensitive values.
- For React projects: use functional components with hooks. Use React Router for navigation. Keep components focused — one responsibility per component.
- For Tailwind CSS: use utility classes directly in JSX/HTML. Make layouts responsive with sm:/md:/lg: breakpoints. Use a consistent color palette.
- For Next.js projects: use the App Router convention (app/ directory). Use server components by default; add "use client" only when state or browser APIs are needed.
- For Express projects: use async/await for route handlers. Always include error handling middleware.
- Write complete, ready-to-run code. Do NOT leave TODO comments or placeholder implementations.
- Return ONLY the raw source code for the requested file. No explanations. No markdown code fences. No leading or trailing commentary.`;

const BATCH_FILE_SYSTEM_MESSAGE = `You are a senior full-stack developer generating multiple source files for a web application in a single pass. You write clean, well-structured, production-quality code.

Rules you MUST follow:
- Use the framework and styling system specified in the project requirements.
- Import modules using correct relative paths. Files in the same batch can reference each other.
- Use environment variables (process.env.SECRET_NAME) for ALL secrets and API keys. NEVER hardcode sensitive values.
- For React projects: use functional components with hooks. Use React Router for navigation.
- For Tailwind CSS: use utility classes directly. Make responsive layouts.
- For Next.js projects: use the App Router convention. Use server components by default.
- For Express projects: use async/await. Include error handling.
- Write complete, ready-to-run code. No TODO placeholders.
- Your response MUST be valid JSON. Do NOT wrap it in markdown code fences. Do NOT include any explanatory text.`;

/**
 * Build the prompt pair for generating a single source file.
 *
 * @param {Object}   requirements    - The parsed project requirements JSON from stage 1.
 * @param {Array}    existingFiles   - Array of { path, content } for files already generated.
 * @param {Object}   fileToGenerate  - { path, description } for the file to create.
 * @param {string}   [contextMd]     - Optional project context markdown.
 * @returns {{ systemMessage: string, prompt: string, maxTokens: number, temperature: number }}
 */
function buildFileGenerationPrompt(requirements, existingFiles, fileToGenerate, contextMd) {
  const reqSummary = _buildRequirementsSummary(requirements);
  const existingFilesSection = _buildExistingFilesSection(existingFiles);

  let prompt = `Generate the source code for a single file in this project.

---
PROJECT REQUIREMENTS:
${reqSummary}
---`;

  if (existingFilesSection) {
    prompt += `

EXISTING PROJECT FILES (for reference — use these to determine correct import paths and avoid duplicating logic):
${existingFilesSection}
---`;
  }

  prompt += `

FILE TO GENERATE:
Path: ${fileToGenerate.path}
Description: ${fileToGenerate.description}
---`;

  if (contextMd) {
    prompt += `

PROJECT CONTEXT:
${contextMd}
---`;
  }

  prompt += `

Return ONLY the raw source code for "${fileToGenerate.path}". No explanations. No markdown fences. No commentary before or after the code.`;

  return {
    systemMessage: SINGLE_FILE_SYSTEM_MESSAGE,
    prompt,
    maxTokens: 8000,
    temperature: 0.2,
  };
}

/**
 * Build the prompt pair for generating multiple source files in one request.
 *
 * @param {Object}   requirements - The parsed project requirements JSON from stage 1.
 * @param {Array}    fileSpecs    - Array of { path, description } files to generate.
 * @param {string}   [contextMd]  - Optional project context markdown.
 * @returns {{ systemMessage: string, prompt: string, maxTokens: number, temperature: number }}
 */
function buildBatchFilePrompt(requirements, fileSpecs, contextMd) {
  const reqSummary = _buildRequirementsSummary(requirements);

  const fileList = fileSpecs
    .map((f, i) => `  ${i + 1}. ${f.path} — ${f.description}`)
    .join('\n');

  let prompt = `Generate all of the following source files for this project in a single response.

---
PROJECT REQUIREMENTS:
${reqSummary}
---

FILES TO GENERATE:
${fileList}
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
      "path": "src/App.jsx",
      "content": "...full file content...",
      "language": "jsx"
    },
    {
      "path": "src/pages/Home.jsx",
      "content": "...full file content...",
      "language": "jsx"
    }
  ]
}

Rules:
- Generate ALL files listed above. Do not skip any.
- Each "content" value must contain the complete, ready-to-run source code.
- "language" should match the file extension (jsx, js, ts, tsx, css, json, html, etc.).
- Files can import from each other using correct relative paths.
- Response MUST be valid JSON. No markdown fences. No commentary.`;

  return {
    systemMessage: BATCH_FILE_SYSTEM_MESSAGE,
    prompt,
    maxTokens: 16000,
    temperature: 0.2,
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
 * Build the "existing files" section, truncating each file to a maximum line count
 * to stay within context window limits.
 * @private
 */
function _buildExistingFilesSection(existingFiles) {
  if (!existingFiles || existingFiles.length === 0) {
    return '';
  }

  const sections = [];

  for (const file of existingFiles) {
    const lines = (file.content || '').split('\n');
    const truncated = lines.length > MAX_EXISTING_FILE_LINES;
    const displayLines = truncated
      ? lines.slice(0, MAX_EXISTING_FILE_LINES)
      : lines;

    let section = `=== ${file.path} ===\n${displayLines.join('\n')}`;
    if (truncated) {
      section += `\n... (truncated — ${lines.length - MAX_EXISTING_FILE_LINES} more lines)`;
    }

    sections.push(section);
  }

  return sections.join('\n\n');
}

module.exports = {
  buildFileGenerationPrompt,
  buildBatchFilePrompt,
};
