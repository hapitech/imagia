const crypto = require('crypto');

function generateContentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function generateCacheKey(prefix, content) {
  const hash = generateContentHash(content);
  return `v1:${prefix}:${hash}`;
}

function llmCacheKey(prompt, model) {
  return generateCacheKey('llm', `${model}:${prompt}`);
}

function projectCacheKey(projectId) {
  return `v1:project:${projectId}`;
}

module.exports = {
  generateContentHash,
  generateCacheKey,
  llmCacheKey,
  projectCacheKey,
};
