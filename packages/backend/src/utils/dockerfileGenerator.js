/**
 * Dockerfile Generator
 *
 * Generates framework-specific Dockerfiles for deploying user-built apps
 * to Railway. Each Dockerfile:
 *   - Uses node:20-alpine for small image size
 *   - Respects $PORT env var (Railway injects this)
 *   - Uses multi-stage builds where beneficial
 */

/**
 * Generate a Dockerfile for the given app type.
 * @param {string} appType - Framework: react, vite, express, node, nextjs, static
 * @param {Object} [options]
 * @param {string} [options.entryPoint] - Main file for Express/Node apps (default: server.js)
 * @returns {string} Dockerfile content
 */
function generateDockerfile(appType, options = {}) {
  const framework = (appType || 'react').toLowerCase();

  switch (framework) {
    case 'react':
    case 'react + vite':
    case 'vite':
      return reactViteDockerfile();
    case 'express':
    case 'node':
      return expressDockerfile(options);
    case 'next':
    case 'nextjs':
    case 'next.js':
      return nextjsDockerfile();
    case 'static':
      return staticDockerfile();
    default:
      // Default to Express-style if unknown
      return expressDockerfile(options);
  }
}

/**
 * Generate a .dockerignore file.
 * @returns {string}
 */
function generateDockerignore() {
  return `node_modules
.env
.env.local
.git
.gitignore
.railway
.railwayignore
dist
.next
README.md
`;
}

// ---------------------------------------------------------------------------
// Framework-specific Dockerfiles
// ---------------------------------------------------------------------------

function reactViteDockerfile() {
  return `FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve@14
COPY --from=build /app/dist ./dist
CMD sh -c "serve -s dist -l \${PORT:-3000}"
`;
}

function expressDockerfile(options) {
  const entryPoint = options.entryPoint || 'server.js';
  return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
CMD ["node", "${entryPoint}"]
`;
}

function nextjsDockerfile() {
  return `FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/public ./public
CMD ["npm", "start"]
`;
}

function staticDockerfile() {
  return `FROM node:20-alpine
WORKDIR /app
RUN npm install -g serve@14
COPY . .
CMD sh -c "serve -s . -l \${PORT:-3000}"
`;
}

module.exports = { generateDockerfile, generateDockerignore };
