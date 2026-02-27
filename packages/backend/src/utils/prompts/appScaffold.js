/**
 * Prompt templates for Stage 1 (Understand Requirements) and Stage 2 (Generate Scaffold).
 *
 * buildRequirementsPrompt  - Sent to Claude to analyze the user's app description and
 *                            produce a structured project plan (JSON).
 * buildScaffoldPrompt      - Sent to Fireworks to generate the initial scaffold files
 *                            (package.json, config files, entry points).
 */

const REQUIREMENTS_SYSTEM_MESSAGE = `You are a senior software architect with deep expertise in modern web application development. Your role is to analyze app descriptions provided by users and produce a structured, actionable project plan.

When analyzing a description you must:
- Identify the most appropriate framework (react, next, express, or static) based on the requirements.
- Select a styling approach (tailwind, css-modules, or styled-components) that fits the project.
- Break the application down into discrete pages, data models, and API endpoints.
- Identify any external services or integrations the app will need.
- List all environment variables that will be required.

Always be pragmatic: prefer React with Vite and Tailwind for most frontend apps, Next.js when SSR/SEO is critical, Express for pure APIs, and static for simple landing pages.

Your response MUST be valid JSON. Do NOT wrap it in markdown code fences. Do NOT include any explanatory text before or after the JSON.`;

const SCAFFOLD_SYSTEM_MESSAGE = `You are a senior software engineer that generates complete, production-ready project scaffolds. You create all the configuration and boilerplate files needed to bootstrap a modern web project.

Rules:
- Generate ONLY configuration and entry-point files (package.json, build config, CSS config, index.html, .env.example). Do NOT generate application source code — that comes later.
- Use exact, pinned dependency versions that are known to work together.
- For React apps: use Vite as the bundler with @vitejs/plugin-react.
- For Next.js apps: use the App Router pattern.
- For Express apps: include cors, dotenv, and a basic server.js entry point.
- Every scaffold MUST include a .env.example listing all required environment variables with placeholder values.
- Your response MUST be valid JSON. Do NOT wrap it in markdown code fences. Do NOT include any explanatory text.`;

/**
 * Build the prompt pair for the "understand requirements" stage.
 *
 * @param {string} userMessage   - The user's natural-language app description.
 * @param {string} [contextMd]  - Existing project context markdown (for iterative builds).
 * @returns {{ systemMessage: string, prompt: string, maxTokens: number, temperature: number }}
 */
function buildRequirementsPrompt(userMessage, contextMd) {
  let prompt = `Analyze the following app description and return a structured project plan as JSON.

---
APP DESCRIPTION:
${userMessage}
---`;

  if (contextMd) {
    prompt += `

EXISTING PROJECT CONTEXT (this is an iterative build — take prior decisions into account):
${contextMd}
---`;
  }

  prompt += `

Return a JSON object with exactly this shape:

{
  "name": "my-app",
  "description": "A brief description of the application",
  "framework": "react",
  "styling": "tailwind",
  "features": ["feature-1", "feature-2"],
  "pages": [
    { "name": "Home", "path": "/", "description": "Landing page with hero section" }
  ],
  "dataModel": [
    { "name": "User", "fields": ["id", "email", "name", "createdAt"] }
  ],
  "apiEndpoints": [
    { "method": "GET", "path": "/api/resource", "description": "Description of endpoint" }
  ],
  "externalServices": ["stripe"],
  "envVarsNeeded": ["STRIPE_SECRET_KEY"]
}

Rules:
- "framework" must be one of: react, next, express, static.
- "styling" must be one of: tailwind, css-modules, styled-components.
- "pages" should be an empty array for express-only or static projects that have no client-side routing.
- "dataModel" should capture the core entities even if there is no database — they clarify the domain.
- "apiEndpoints" should be an empty array if the app has no backend API layer.
- "externalServices" should only list third-party services that require API keys or SDK integration.
- "envVarsNeeded" must include a variable for every external service listed.
- Response MUST be valid JSON. No markdown fences. No commentary.`;

  return {
    systemMessage: REQUIREMENTS_SYSTEM_MESSAGE,
    prompt,
    maxTokens: 3000,
    temperature: 0.5,
  };
}

/**
 * Build the prompt pair for the "generate scaffold" stage.
 *
 * @param {Object} requirements - The parsed JSON requirements from stage 1.
 * @returns {{ systemMessage: string, prompt: string, maxTokens: number, temperature: number }}
 */
function buildScaffoldPrompt(requirements) {
  const frameworkGuide = _getFrameworkGuide(requirements.framework);

  const prompt = `Generate the project scaffold files for the following requirements:

---
PROJECT REQUIREMENTS:
${JSON.stringify(requirements, null, 2)}
---

${frameworkGuide}

Return a JSON object with exactly this shape:

{
  "files": [
    {
      "path": "package.json",
      "content": "{ full file content as a string }",
      "language": "json"
    },
    {
      "path": "vite.config.js",
      "content": "...",
      "language": "javascript"
    }
  ]
}

Rules:
- Every file object must have "path", "content", and "language" keys.
- "content" must be the complete, valid file content as a string.
- "path" must be relative to the project root (no leading slash).
- Do NOT generate application source files (components, pages, routes). Only generate configuration, build tooling, entry points, and .env.example.
- The package.json must include a "scripts" section with at least "dev", "build", and "start" commands.
- Response MUST be valid JSON. No markdown fences. No commentary.`;

  return {
    systemMessage: SCAFFOLD_SYSTEM_MESSAGE,
    prompt,
    maxTokens: 4000,
    temperature: 0.3,
  };
}

/**
 * Return framework-specific instructions to embed in the scaffold prompt.
 * @private
 */
function _getFrameworkGuide(framework) {
  switch (framework) {
    case 'react':
      return `FRAMEWORK GUIDE — React + Vite:
Generate these files:
1. package.json — dependencies: react (^18.3.1), react-dom (^18.3.1), react-router-dom (^6.26.0). devDependencies: vite (^5.4.0), @vitejs/plugin-react (^4.3.1), tailwindcss (^3.4.10), postcss (^8.4.41), autoprefixer (^10.4.20).
2. vite.config.js — import react plugin, set server port to 5173.
3. tailwind.config.js — content paths: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"].
4. postcss.config.js — plugins: tailwindcss, autoprefixer.
5. index.html — basic HTML5 shell with <div id="root"></div> and <script type="module" src="/src/main.jsx"></script>.
6. .env.example — list all envVarsNeeded with placeholder values.`;

    case 'next':
      return `FRAMEWORK GUIDE — Next.js:
Generate these files:
1. package.json — dependencies: next (^14.2.5), react (^18.3.1), react-dom (^18.3.1). devDependencies: tailwindcss (^3.4.10), postcss (^8.4.41), autoprefixer (^10.4.20). Scripts: "dev": "next dev", "build": "next build", "start": "next start".
2. next.config.js — basic config with reactStrictMode: true.
3. tailwind.config.js — content paths: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"].
4. postcss.config.js — plugins: tailwindcss, autoprefixer.
5. .env.example — list all envVarsNeeded with placeholder values.`;

    case 'express':
      return `FRAMEWORK GUIDE — Express API:
Generate these files:
1. package.json — dependencies: express (^4.19.2), cors (^2.8.5), dotenv (^16.4.5). Scripts: "dev": "node --watch server.js", "start": "node server.js".
2. server.js — basic Express setup: load dotenv, apply cors and JSON body parser, health-check route at GET /health, listen on process.env.PORT || 3001.
3. .env.example — list all envVarsNeeded with placeholder values plus PORT=3001.`;

    case 'static':
      return `FRAMEWORK GUIDE — Static Site:
Generate these files:
1. package.json — devDependencies: tailwindcss (^3.4.10), postcss-cli (^11.0.0), autoprefixer (^10.4.20). Scripts: "dev": "npx tailwindcss -i ./src/input.css -o ./dist/output.css --watch", "build": "npx tailwindcss -i ./src/input.css -o ./dist/output.css --minify".
2. tailwind.config.js — content paths: ["./*.html", "./src/**/*.{html,js}"].
3. postcss.config.js — plugins: tailwindcss, autoprefixer.
4. index.html — basic HTML5 page linking dist/output.css.
5. src/input.css — Tailwind directives (@tailwind base; @tailwind components; @tailwind utilities;).
6. .env.example — list all envVarsNeeded with placeholder values (if any).`;

    default:
      return `Generate scaffold files appropriate for the chosen framework. Include package.json, build configuration, and .env.example.`;
  }
}

module.exports = {
  buildRequirementsPrompt,
  buildScaffoldPrompt,
};
