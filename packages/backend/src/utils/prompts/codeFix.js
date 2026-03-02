/**
 * Prompt template for the auto-fix stage of the multi-step build pipeline (Stage 6).
 *
 * Receives validation errors + the affected file content and instructs the LLM
 * to make minimal, targeted fixes.
 */

const FIX_SYSTEM_MESSAGE = `You are a senior software developer fixing specific errors in generated code. You make MINIMAL changes — only fix the reported errors and nothing else.

Rules:
- Fix ONLY the errors listed below. Do NOT refactor, restyle, or "improve" anything.
- Return the FULL corrected content for each file that needs a fix.
- If an error is about a missing import, add the import. If about a syntax error, fix the syntax.
- If a file imports a module that doesn't exist and you can't determine what it should be, remove the import.
- Do NOT change files that have no errors.
- Your response MUST be valid JSON. No markdown fences. No commentary.`;

/**
 * Build a focused fix prompt with error messages, line numbers, and affected file content.
 *
 * @param {Array<{file: string, line?: number, message: string, type: string}>} errors
 * @param {Array<{path: string, content: string}>} affectedFiles - Files that have errors
 * @param {Array<{path: string, content: string}>} contextFiles - Other project files for reference (imports, etc.)
 * @param {string} contextMd - Project context markdown
 * @returns {{ systemMessage: string, prompt: string, maxTokens: number, temperature: number }}
 */
function buildCodeFixPrompt(errors, affectedFiles, contextFiles, contextMd) {
  const errorList = errors
    .map((e) => {
      const loc = e.line ? ` (line ${e.line}${e.column ? `:${e.column}` : ''})` : '';
      return `- [${e.type}] ${e.file}${loc}: ${e.message}`;
    })
    .join('\n');

  const affectedSection = affectedFiles
    .map((f) => `=== ${f.path} ===\n${f.content}`)
    .join('\n\n');

  // Include a brief listing of context files (just paths) so the LLM knows what's available
  const contextFilesList = contextFiles
    .map((f) => f.path)
    .join('\n');

  let prompt = `Fix the following errors in the generated code. Make MINIMAL changes.

---
ERRORS TO FIX:
${errorList}
---

FILES WITH ERRORS (full content):
${affectedSection}
---

OTHER PROJECT FILES (paths only, for import reference):
${contextFilesList}
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
      "content": "...full corrected file content...",
      "language": "jsx",
      "action": "modify"
    }
  ],
  "summary": "Brief description of fixes applied",
  "remainingIssues": []
}

Rules:
- Only include files that you actually changed to fix errors.
- "action" should be "modify" for all files (you're fixing, not creating).
- For each file, return the COMPLETE corrected content — not a diff.
- "remainingIssues" should list any errors you could NOT fix (empty array if all fixed).
- Response MUST be valid JSON.`;

  return {
    systemMessage: FIX_SYSTEM_MESSAGE,
    prompt,
    maxTokens: 16000,
    temperature: 0.2,
  };
}

module.exports = {
  buildCodeFixPrompt,
};
