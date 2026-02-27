import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

// Request interceptor: attach Clerk session token
api.interceptors.request.use(async (config) => {
  // Clerk exposes the session through the window.__clerk_frontend_api or via the hook.
  // We store the getToken function from the auth hook and call it here.
  if (api._getToken) {
    try {
      const token = await api._getToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Token retrieval failed; proceed without auth header
    }
  }
  return config;
});

// Response interceptor: handle 401
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      window.location.href = '/sign-in';
    }
    return Promise.reject(error);
  }
);

/**
 * Call this once from useAuth hook to wire up token retrieval.
 */
export function setTokenGetter(getToken) {
  api._getToken = getToken;
}

// ----- Projects -----
export function getProjects(params) {
  return api.get('/projects', { params }).then((r) => r.data);
}

export function createProject(data) {
  return api.post('/projects', data).then((r) => r.data);
}

export function getProject(id) {
  return api.get(`/projects/${id}`).then((r) => r.data);
}

export function updateProject(id, data) {
  return api.patch(`/projects/${id}`, data).then((r) => r.data);
}

export function deleteProject(id) {
  return api.delete(`/projects/${id}`).then((r) => r.data);
}

// ----- Project Files -----
export function getProjectFiles(projectId) {
  return api.get(`/projects/${projectId}/files`).then((r) => r.data);
}

// ----- Conversations -----
export function getConversations(projectId) {
  return api.get(`/projects/${projectId}/conversations`).then((r) => r.data);
}

export function createConversation(data) {
  return api.post('/conversations', data).then((r) => r.data);
}

// ----- Messages -----
export function getMessages(conversationId, params) {
  return api.get(`/conversations/${conversationId}/messages`, { params }).then((r) => r.data);
}

export function sendMessage(conversationId, data) {
  return api.post(`/conversations/${conversationId}/messages`, data).then((r) => r.data);
}

// ----- Secrets -----
export function getProjectSecrets(projectId) {
  return api.get(`/projects/${projectId}/secrets`).then((r) => r.data);
}

export function addSecret(projectId, data) {
  return api.post(`/projects/${projectId}/secrets`, data).then((r) => r.data);
}

export function deleteSecret(projectId, secretId) {
  return api.delete(`/projects/${projectId}/secrets/${secretId}`).then((r) => r.data);
}

// ----- Uploads -----
export function uploadFiles(projectId, files) {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  return api.post(`/uploads/${projectId}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data);
}

// ----- Build / Processing -----
export function getBuildStatus(projectId) {
  return api.get(`/projects/${projectId}/build/status`).then((r) => r.data);
}

// ----- Prompts -----
export function getPrompts(params) {
  return api.get('/prompts', { params }).then((r) => r.data);
}

export function getPromptStats() {
  return api.get('/prompts/stats').then((r) => r.data);
}

// ----- Deployments -----
export function deployProject(projectId) {
  return api.post('/deployments', { project_id: projectId }).then((r) => r.data);
}

export function getDeploymentStatus(projectId) {
  return api.get(`/deployments/${projectId}/status`).then((r) => r.data);
}

export function getDeploymentHistory(projectId) {
  return api.get(`/deployments/${projectId}/history`).then((r) => r.data);
}

export function getDeploymentLogs(projectId) {
  return api.get(`/deployments/${projectId}/logs`).then((r) => r.data);
}

export function setCustomDomain(projectId, domain) {
  return api.patch(`/deployments/${projectId}/domain`, { domain }).then((r) => r.data);
}

export function getDeploymentCosts(projectId) {
  return api.get(`/deployments/${projectId}/costs`).then((r) => r.data);
}

// ----- GitHub -----
export function githubConnect() {
  return api.post('/github/connect').then((r) => r.data);
}

export function githubCallback(code) {
  return api.post('/github/callback', { code }).then((r) => r.data);
}

export function githubListRepos(params) {
  return api.get('/github/repos', { params }).then((r) => r.data);
}

export function githubImportRepo(data) {
  return api.post('/github/import', data).then((r) => r.data);
}

export function githubPush(projectId, commitMessage) {
  return api.post(`/github/projects/${projectId}/push`, { commit_message: commitMessage }).then((r) => r.data);
}

export function githubPull(projectId) {
  return api.post(`/github/projects/${projectId}/pull`).then((r) => r.data);
}

export function githubCreateRepo(projectId, data) {
  return api.post(`/github/projects/${projectId}/create-repo`, data).then((r) => r.data);
}

export function githubSyncStatus(projectId) {
  return api.get(`/github/projects/${projectId}/sync-status`).then((r) => r.data);
}

export function githubDisconnect(projectId) {
  return api.delete(`/github/projects/${projectId}/disconnect`).then((r) => r.data);
}

// ----- Marketing -----
export function generateMarketingAssets(projectId, assetTypes) {
  return api.post('/marketing/generate', { project_id: projectId, asset_types: assetTypes }).then((r) => r.data);
}

export function getMarketingAssets(projectId, params) {
  return api.get(`/marketing/assets/${projectId}`, { params }).then((r) => r.data);
}

export function getMarketingAsset(projectId, assetId) {
  return api.get(`/marketing/assets/${projectId}/${assetId}`).then((r) => r.data);
}

export function deleteMarketingAsset(projectId, assetId) {
  return api.delete(`/marketing/assets/${projectId}/${assetId}`).then((r) => r.data);
}

export function regenerateMarketingAsset(projectId, assetType) {
  return api.post(`/marketing/assets/${projectId}/regenerate/${assetType}`).then((r) => r.data);
}

// ----- Prompts -----
export function getPromptFilters() {
  return api.get('/prompts/filters').then((r) => r.data);
}

export function getPromptDetail(id) {
  return api.get(`/prompts/${id}`).then((r) => r.data);
}

// ----- Analytics -----
export function getLLMCosts(params) {
  return api.get('/analytics/llm-costs', { params }).then((r) => r.data);
}

export function getLLMCostsByModel(params) {
  return api.get('/analytics/llm-costs/by-model', { params }).then((r) => r.data);
}

export function getUsageDaily(params) {
  return api.get('/analytics/usage-daily', { params }).then((r) => r.data);
}

export function getProjectLLMCosts(projectId) {
  return api.get(`/analytics/llm-costs/${projectId}`).then((r) => r.data);
}

export function getFullCostSummary(params) {
  return api.get('/analytics/costs', { params }).then((r) => r.data);
}

export function getProjectFullCosts(projectId) {
  return api.get(`/analytics/costs/${projectId}`).then((r) => r.data);
}

// ----- Social Media -----
export function getSocialPlatforms() {
  return api.get('/social/platforms').then((r) => r.data);
}

export function getSocialAccounts() {
  return api.get('/social/accounts').then((r) => r.data);
}

export function getSocialOAuthUrl(platform) {
  return api.post(`/social/oauth/authorize/${platform}`).then((r) => r.data);
}

export function socialOAuthCallback(platform, code, state) {
  return api.post(`/social/oauth/callback/${platform}`, { code, state }).then((r) => r.data);
}

export function disconnectSocialAccount(accountId) {
  return api.delete(`/social/accounts/${accountId}`).then((r) => r.data);
}

export function createSocialPost(data) {
  return api.post('/social/posts', data).then((r) => r.data);
}

export function getSocialPosts(params) {
  return api.get('/social/posts', { params }).then((r) => r.data);
}

export function updateSocialPost(postId, data) {
  return api.patch(`/social/posts/${postId}`, data).then((r) => r.data);
}

export function deleteSocialPost(postId) {
  return api.delete(`/social/posts/${postId}`).then((r) => r.data);
}

export function publishSocialPost(postId) {
  return api.post(`/social/posts/${postId}/publish`).then((r) => r.data);
}

export function refreshEngagement(postId) {
  return api.post(`/social/posts/${postId}/engagement`).then((r) => r.data);
}

export function validateSocialContent(content, platform) {
  return api.post('/social/validate', { content, platform }).then((r) => r.data);
}

export default api;
