/**
 * Prompt templates for the multi-step build pipeline — Stages 1 & 2.
 *
 * Stage 1 (Analyze): Receives file paths only (not content), classifies intent
 * and identifies affected files.
 *
 * Stage 2 (Plan): Receives affected file content, produces an ordered change plan.
 */

const ANALYSIS_SYSTEM_MESSAGE = `You are a senior software architect analyzing a change request for an existing web application. Your job is to determine WHICH files are affected — not to write code.

Rules:
- Analyze the user's request and classify the change type.
- Identify which existing files need to be modified, and which new files need to be created.
- Be conservative: only list files that ACTUALLY need to change. Do not list files just because they exist.
- Consider transitive dependencies: if a component is renamed, files that import it also need updating.
- Your response MUST be valid JSON. No markdown fences. No commentary.`;

const PLAN_SYSTEM_MESSAGE = `You are a senior software architect creating a precise change plan for a code modification. You receive the full content of affected files and must plan exactly what changes are needed.

Rules:
- Create a detailed plan for each file that needs to change.
- Group related changes together (e.g. a new component + its import in a parent).
- Specify the action (modify, create, delete) for each file.
- Order the plan so dependencies are created before files that import them.
- Your response MUST be valid JSON. No markdown fences. No commentary.`;

/**
 * Build the Stage 1 analysis prompt. Receives ONLY file paths (not content)
 * to keep the prompt small and fast for the cheap model.
 *
 * @param {string} userMessage - The user's change request
 * @param {Array<string>} fileManifest - Array of file paths in the project
 * @param {string} contextMd - Project context markdown
 * @returns {{ systemMessage: string, prompt: string, maxTokens: number, temperature: number }}
 */
function buildChangeAnalysisPrompt(userMessage, fileManifest, contextMd) {
  const fileList = fileManifest.join('\n');

  let prompt = `Analyze this change request and identify which files are affected.

---
USER REQUEST:
${userMessage}
---

PROJECT FILES (paths only):
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
  "changeType": "feature|bugfix|refactor|styling|content|config",
  "summary": "One-sentence description of what needs to change",
  "affectedFiles": ["src/pages/Home.jsx", "src/components/Header.jsx"],
  "newFilesNeeded": ["src/components/NewWidget.jsx"],
  "complexity": "low|medium|high"
}

Rules:
- "affectedFiles" lists EXISTING files that need modification. Only include files from the manifest above.
- "newFilesNeeded" lists files that need to be CREATED. Use conventional paths (src/components/, src/pages/, etc.).
- "complexity" is your estimate: low (1-2 files), medium (3-5 files), high (6+ files).
- If the request is too vague to determine affected files, return empty arrays and "complexity": "unknown".
- Response MUST be valid JSON.`;

  return {
    systemMessage: ANALYSIS_SYSTEM_MESSAGE,
    prompt,
    maxTokens: 2048,
    temperature: 0.2,
  };
}

/**
 * Build the Stage 2 planning prompt. Receives the full content of affected
 * files so the model can plan precise changes.
 *
 * @param {string} userMessage - The user's change request
 * @param {Object} analysis - Stage 1 analysis result
 * @param {Array<{path: string, content: string}>} affectedFiles - Full content of affected files
 * @param {string} contextMd - Project context markdown
 * @returns {{ systemMessage: string, prompt: string, maxTokens: number, temperature: number }}
 */
function buildChangePlanPrompt(userMessage, analysis, affectedFiles, contextMd) {
  const filesSection = affectedFiles
    .map((f) => `=== ${f.path} ===\n${f.content}`)
    .join('\n\n');

  let prompt = `Create a detailed change plan for this modification request.

---
USER REQUEST:
${userMessage}
---

ANALYSIS:
Change type: ${analysis.changeType}
Summary: ${analysis.summary}
New files needed: ${(analysis.newFilesNeeded || []).join(', ') || 'none'}
---

AFFECTED FILE CONTENTS:
${filesSection}
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
  "plan": [
    {
      "path": "src/components/Header.jsx",
      "action": "modify",
      "description": "Add navigation link for new page",
      "group": 1
    },
    {
      "path": "src/components/NewWidget.jsx",
      "action": "create",
      "description": "New widget component with form and state management",
      "group": 1
    }
  ],
  "summary": "Brief overall description of the planned changes",
  "generationGroups": [
    {
      "group": 1,
      "description": "New widget component and header update",
      "files": ["src/components/NewWidget.jsx", "src/components/Header.jsx"]
    }
  ]
}

Rules:
- "action" must be one of: "modify", "create", or "delete".
- "group" is a number grouping related files that should be generated together (same LLM call).
- "generationGroups" lists the groups with which files belong to each. Files in the same group are generated in one call.
- Keep groups small (1-4 files each) for better quality.
- Order groups so dependencies come first (e.g. create a component before updating its parent).
- Response MUST be valid JSON.`;

  return {
    systemMessage: PLAN_SYSTEM_MESSAGE,
    prompt,
    maxTokens: 4096,
    temperature: 0.2,
  };
}

module.exports = {
  buildChangeAnalysisPrompt,
  buildChangePlanPrompt,
};
