import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import useProgress from '../hooks/useProgress';
import useChat from '../hooks/useChat';
import useIsMobile from '../hooks/useIsMobile';
import {
  getProject,
  getProjectFiles,
  getProjectSecrets,
  addSecret,
  deleteSecret,
  detectSecrets,
  deployProject,
  getDeploymentStatus,
  githubPush,
  githubPull,
  githubSyncStatus,
  githubCreateRepo,
  getAvailableModels,
  getProjectDomains,
  addCustomDomain,
  removeProjectDomain,
  getDomainStatus,
  updateProject,
} from '../services/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECRET_TYPES = ['api_key', 'oauth_token', 'database_url', 'env_variable', 'other'];

const LANG_COLORS = {
  javascript: 'bg-yellow-400 text-yellow-900',
  jsx: 'bg-sky-400 text-sky-900',
  typescript: 'bg-blue-500 text-white',
  tsx: 'bg-blue-400 text-white',
  python: 'bg-green-500 text-white',
  html: 'bg-orange-500 text-white',
  css: 'bg-purple-500 text-white',
  json: 'bg-gray-500 text-white',
  markdown: 'bg-gray-400 text-white',
  sql: 'bg-red-400 text-white',
  yaml: 'bg-pink-400 text-white',
  shell: 'bg-gray-600 text-white',
  dockerfile: 'bg-blue-600 text-white',
};

const FILE_ICONS = {
  javascript: '{}',
  jsx: '</>',
  typescript: 'TS',
  tsx: 'TX',
  python: 'Py',
  html: '<>',
  css: '#',
  json: '{}',
  sql: 'DB',
  yaml: 'YA',
  shell: '$',
  dockerfile: 'D',
};

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Format an ISO date string to a readable short time. */
function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Detect the language from a file path. */
function detectLanguage(filePath) {
  if (!filePath) return null;
  const ext = filePath.split('.').pop().toLowerCase();
  const map = {
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    py: 'python',
    html: 'html',
    css: 'css',
    json: 'json',
    md: 'markdown',
    sql: 'sql',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'shell',
    bash: 'shell',
    Dockerfile: 'dockerfile',
  };
  if (filePath.endsWith('Dockerfile')) return 'dockerfile';
  return map[ext] || null;
}

/** Format a date to a readable label for timeline grouping. */
function fmtDateLabel(iso) {
  if (!iso) return 'Unknown';
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - msgDay) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

/** Summarize an assistant message into a short checkpoint label. */
function summarizeMessage(content) {
  if (!content) return 'AI response';
  // Strip code blocks
  const text = content.replace(/```[\s\S]*?```/g, '').trim();
  // Take first sentence or first 80 chars
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim();
  if (firstSentence && firstSentence.length <= 80) return firstSentence;
  return text.substring(0, 80) + (text.length > 80 ? '...' : '');
}

/**
 * Group messages into timeline sections.
 * Recent messages (today) are shown individually.
 * Older messages are grouped by date into collapsible checkpoints.
 */
function groupMessagesIntoTimeline(messages) {
  if (!messages || messages.length === 0) return { recentMessages: [], checkpoints: [] };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Split into today vs older
  const todayMessages = [];
  const olderMessages = [];

  for (const msg of messages) {
    const msgDate = msg.created_at ? new Date(msg.created_at) : null;
    // Treat messages with no date or temp IDs as recent (optimistic UI)
    if (!msgDate || msgDate >= today || String(msg.id).startsWith('temp-')) {
      todayMessages.push(msg);
    } else {
      olderMessages.push(msg);
    }
  }

  // Group older messages by date
  const checkpointMap = new Map();
  for (const msg of olderMessages) {
    const label = fmtDateLabel(msg.created_at);
    if (!checkpointMap.has(label)) {
      checkpointMap.set(label, { label, messages: [], firstTime: msg.created_at });
    }
    checkpointMap.get(label).messages.push(msg);
  }

  // Build checkpoint summaries
  const checkpoints = [];
  for (const [label, group] of checkpointMap) {
    const userMsgCount = group.messages.filter((m) => m.role === 'user').length;
    const assistantMsgs = group.messages.filter((m) => m.role === 'assistant' && !m.metadata?.error);
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    const summary = lastAssistant ? summarizeMessage(lastAssistant.content) : `${userMsgCount} message${userMsgCount !== 1 ? 's' : ''}`;

    checkpoints.push({
      label,
      summary,
      messages: group.messages,
      messageCount: group.messages.length,
      firstTime: group.firstTime,
    });
  }

  return { recentMessages: todayMessages, checkpoints };
}

/** Parse message content and split into text and code blocks. */
function parseContent(content) {
  if (!content) return [{ type: 'text', value: '' }];
  const parts = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    // Text before code block
    if (match.index > lastIndex) {
      const text = content.slice(lastIndex, match.index);
      if (text.trim()) parts.push({ type: 'text', value: text });
    }
    parts.push({ type: 'code', lang: match[1] || 'text', value: match[2] });
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  const tail = content.slice(lastIndex);
  if (tail.trim()) parts.push({ type: 'text', value: tail });

  if (parts.length === 0) parts.push({ type: 'text', value: content });
  return parts;
}

/** Build a tree structure from a flat list of file paths. */
function buildFileTree(files) {
  const root = { name: '/', children: {}, files: [] };

  for (const file of files) {
    const path = file.file_path || file.path || '';
    const segments = path.split('/').filter(Boolean);
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (i === segments.length - 1) {
        // It is a file
        current.files.push({ ...file, displayName: seg });
      } else {
        // It is a folder
        if (!current.children[seg]) {
          current.children[seg] = { name: seg, children: {}, files: [] };
        }
        current = current.children[seg];
      }
    }
  }

  return root;
}

// ============================================================================
// Main Component
// ============================================================================

export default function ProjectBuilder() {
  const { id: projectId } = useParams();
  const { progress, stage, message: progressMessage, isConnected } = useProgress(projectId);
  const {
    messages,
    isLoading: chatLoading,
    isSending,
    isUploading,
    detectedSecrets,
    pendingAttachments,
    sendMessage,
    saveSecretsAndRetry,
    refreshMessages,
    dismissSecrets,
    addAttachments,
    removeAttachment,
    conversationId,
  } = useChat(projectId);

  const fileInputRef = useRef(null);

  // -- Project state ---
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);

  // -- Chat input ---
  const [prompt, setPrompt] = useState('');
  const [secretValues, setSecretValues] = useState({});
  const [selectedModel, setSelectedModel] = useState('auto');
  const [availableModels, setAvailableModels] = useState([]);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);

  // -- Timeline grouping for chat history ---
  const timeline = useMemo(() => groupMessagesIntoTimeline(messages), [messages]);

  // -- Build state tracking ---
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildSuccess, setBuildSuccess] = useState(false);
  const [buildError, setBuildError] = useState(false);
  const latestProgressMessage = useRef('');

  // -- Right panel ---
  const [activeTab, setActiveTab] = useState('preview');
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [secrets, setSecrets] = useState([]);
  const [newSecret, setNewSecret] = useState({ key: '', value: '', type: 'api_key' });
  const [domains, setDomains] = useState([]);
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const [chatWidth, setChatWidth] = useState(38); // percentage, default 38%
  const isDragging = useRef(false);
  const containerRef = useRef(null);

  // -- Deploy + GitHub state ---
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployStatus, setDeployStatus] = useState(null);
  const [githubStatus, setGithubStatus] = useState(null);
  const [showGitHubModal, setShowGitHubModal] = useState(false);
  const [gitRepoName, setGitRepoName] = useState('');
  const [gitIsPrivate, setGitIsPrivate] = useState(false);
  const [mobilePanel, setMobilePanel] = useState('chat');
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const isMobile = useIsMobile();

  // -- Toast notifications ---
  const [toast, setToast] = useState(null); // { type: 'success'|'error'|'info', message, detail? }
  const toastTimerRef = useRef(null);
  function showToast(type, message, detail) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ type, message, detail });
    toastTimerRef.current = setTimeout(() => setToast(null), type === 'error' ? 6000 : 4000);
  }

  // -- Git operation loading state ---
  const [gitPushing, setGitPushing] = useState(false);
  const [gitPulling, setGitPulling] = useState(false);

  // ---- Load project on mount ------------------------------------------------
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const proj = await getProject(projectId);
        if (!cancelled) setProject(proj.project || proj);

        const [fileData, secretData, domainData] = await Promise.all([
          getProjectFiles(projectId).catch(() => []),
          getProjectSecrets(projectId).catch(() => []),
          getProjectDomains(projectId).catch(() => ({ domains: [] })),
        ]);

        if (!cancelled) {
          setFiles(Array.isArray(fileData) ? fileData : fileData.files || []);
          setSecrets(Array.isArray(secretData) ? secretData : secretData.secrets || []);
          setDomains(domainData.domains || []);
        }
      } catch (err) {
        console.error('Failed to load project:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [projectId]);

  // ---- Load available models -------------------------------------------------
  useEffect(() => {
    getAvailableModels()
      .then((data) => {
        const models = data?.models?.code || [];
        setAvailableModels(models);
      })
      .catch(() => {});
  }, []);

  // ---- Track build progress -------------------------------------------------
  useEffect(() => {
    if (progress > 0 && progress < 100) {
      setIsBuilding(true);
      setBuildSuccess(false);
      setBuildError(false);
    } else if (progress >= 100) {
      setIsBuilding(false);
      setBuildSuccess(true);
      setBuildError(false);
      // Refresh files & messages when build completes
      getProjectFiles(projectId)
        .then((data) => setFiles(Array.isArray(data) ? data : data.files || []))
        .catch(() => {});
      refreshMessages();
      // Clear success after 5s
      const timer = setTimeout(() => setBuildSuccess(false), 5000);
      return () => clearTimeout(timer);
    } else if (progress === -1) {
      setIsBuilding(false);
      setBuildSuccess(false);
      setBuildError(true);
      refreshMessages();
      const timer = setTimeout(() => setBuildError(false), 8000);
      return () => clearTimeout(timer);
    }
  }, [progress, projectId, refreshMessages]);

  // ---- Keep track of progress message text ---
  useEffect(() => {
    if (progressMessage) latestProgressMessage.current = progressMessage;
  }, [progressMessage]);

  // ---- Auto-scroll messages --------------------------------------------------
  const hasScrolledOnLoad = useRef(false);
  useEffect(() => {
    if (!messagesEndRef.current) return;
    // On initial load, scroll instantly (no animation) so user sees latest message
    if (!hasScrolledOnLoad.current && messages.length > 0) {
      hasScrolledOnLoad.current = true;
      messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
    } else {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, detectedSecrets, isSending, progressMessage]);

  // ---- Initialize secret values when detected --------------------------------
  useEffect(() => {
    if (detectedSecrets && detectedSecrets.length > 0) {
      const initial = {};
      detectedSecrets.forEach((s) => {
        initial[s.key] = { value: '', type: s.type || 'api_key' };
      });
      setSecretValues(initial);
    }
  }, [detectedSecrets]);

  // ---- Handlers --------------------------------------------------------------

  async function handleSend(e) {
    e?.preventDefault();
    if (!prompt.trim() || isSending || isBuilding) return;
    const content = prompt;
    setPrompt('');
    await sendMessage(content, null, selectedModel);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleFileSelect(e) {
    if (e.target.files && e.target.files.length > 0) {
      addAttachments(e.target.files);
      e.target.value = '';
    }
  }

  async function handleSubmitSecrets() {
    if (!detectedSecrets) return;
    const entries = detectedSecrets.map((s) => ({
      key: s.key,
      value: secretValues[s.key]?.value || '',
      type: secretValues[s.key]?.type || s.type || 'api_key',
    }));
    await saveSecretsAndRetry(entries);
    // Refresh the secrets list in the right panel
    const data = await getProjectSecrets(projectId).catch(() => []);
    setSecrets(Array.isArray(data) ? data : data.secrets || []);
  }

  async function handleAddSecret(e) {
    e.preventDefault();
    if (!newSecret.key.trim() || !newSecret.value.trim()) return;
    try {
      await addSecret(projectId, newSecret);
      const data = await getProjectSecrets(projectId);
      setSecrets(Array.isArray(data) ? data : data.secrets || []);
      setNewSecret({ key: '', value: '', type: 'api_key' });
    } catch (err) {
      console.error('Failed to add secret:', err);
    }
  }

  async function handleDeleteSecret(secretId) {
    try {
      await deleteSecret(projectId, secretId);
      setSecrets((prev) => prev.filter((s) => s.id !== secretId));
    } catch (err) {
      console.error('Failed to delete secret:', err);
    }
  }

  // -- Secret detection from files --
  const [fileDetectedSecrets, setFileDetectedSecrets] = useState(null);
  const [detecting, setDetecting] = useState(false);

  async function handleDetectSecrets() {
    try {
      setDetecting(true);
      const data = await detectSecrets(projectId);
      setFileDetectedSecrets(data.detected || []);
    } catch (err) {
      console.error('Secret detection failed:', err);
    } finally {
      setDetecting(false);
    }
  }

  function handleAddDetectedSecret(secret) {
    setNewSecret({ key: secret.key, value: '', type: secret.type || 'api_key' });
    // Remove from detected list
    setFileDetectedSecrets((prev) => prev?.filter((s) => s.key !== secret.key) || null);
  }

  // -- Domain handlers --
  async function handleAddDomain(domain) {
    try {
      const result = await addCustomDomain(projectId, domain);
      const data = await getProjectDomains(projectId).catch(() => ({ domains: [] }));
      setDomains(data.domains || []);
      return result;
    } catch (err) {
      console.error('Failed to add domain:', err);
      throw err;
    }
  }

  async function handleRemoveDomain(domainId) {
    try {
      await removeProjectDomain(projectId, domainId);
      setDomains((prev) => prev.filter((d) => d.id !== domainId));
    } catch (err) {
      console.error('Failed to remove domain:', err);
    }
  }

  async function handleRefreshDomainStatus(domainId) {
    try {
      const status = await getDomainStatus(projectId, domainId);
      setDomains((prev) => prev.map((d) =>
        d.id === domainId ? { ...d, ssl_status: status.ssl_status, verified_at: status.verified ? new Date().toISOString() : d.verified_at } : d
      ));
      return status;
    } catch (err) {
      console.error('Failed to check domain status:', err);
    }
  }

  // -- Deploy handler --
  async function handleDeploy() {
    if (isDeploying) return;
    try {
      setIsDeploying(true);
      await deployProject(projectId);
      // The deploy progress will come through SSE
    } catch (err) {
      console.error('Deploy failed:', err);
      setIsDeploying(false);
    }
  }

  // -- GitHub handlers --
  async function handleGitHubPush() {
    setGitPushing(true);
    try {
      const result = await githubPush(projectId, 'Update from Imagia');
      showToast('success', 'Pushed to GitHub', `Commit ${result.commit_sha?.slice(0, 7) || ''}`);
      refreshGitHubStatus();
    } catch (err) {
      showToast('error', 'Push failed', err.response?.data?.error || err.message);
    } finally {
      setGitPushing(false);
    }
  }

  async function handleGitHubPull() {
    setGitPulling(true);
    try {
      const result = await githubPull(projectId);
      showToast('success', 'Pulled from GitHub', `${result.file_count} files updated`);
      const fileData = await getProjectFiles(projectId).catch(() => []);
      setFiles(Array.isArray(fileData) ? fileData : fileData.files || []);
    } catch (err) {
      showToast('error', 'Pull failed', err.response?.data?.error || err.message);
    } finally {
      setGitPulling(false);
    }
  }

  async function handleCreateRepo(e) {
    e.preventDefault();
    if (!gitRepoName.trim()) return;
    try {
      const result = await githubCreateRepo(projectId, {
        repo_name: gitRepoName,
        is_private: gitIsPrivate,
      });
      setShowGitHubModal(false);
      setGitRepoName('');
      setProject((prev) => ({ ...prev, github_repo_url: result.repo?.html_url }));
      refreshGitHubStatus();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create repo');
    }
  }

  function handleConnectGitHub() {
    // Navigate to Settings where user can connect GitHub via Clerk
    window.location.href = '/settings';
  }

  async function refreshGitHubStatus() {
    try {
      const status = await githubSyncStatus(projectId);
      setGithubStatus(status);
    } catch {
      setGithubStatus(null);
    }
  }

  // Load deploy + GitHub status on mount
  useEffect(() => {
    if (!projectId) return;
    getDeploymentStatus(projectId).then(setDeployStatus).catch(() => {});
    githubSyncStatus(projectId).then(setGithubStatus).catch(() => {});
  }, [projectId]);

  // Clear deploying state when progress completes
  useEffect(() => {
    if (progress >= 100 || progress === -1) {
      setIsDeploying(false);
      getDeploymentStatus(projectId).then(setDeployStatus).catch(() => {});
      // Refresh domains — a new subdomain may have been assigned
      getProjectDomains(projectId).then((data) => setDomains(data.domains || [])).catch(() => {});
    }
  }, [progress, projectId]);

  const toggleFolder = useCallback((path) => {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  // Drag-to-resize handler for chat/preview split
  const handleDragStart = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      setChatWidth(Math.min(70, Math.max(20, pct)));
    };
    const onUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const hasMessages = messages.length > 0;
  const placeholder = hasMessages
    ? 'Tell me what to change...'
    : 'Describe what you want to build...';

  // ---- Loading state ---------------------------------------------------------
  if (loading || chatLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          <p className="text-sm text-gray-500">Loading project...</p>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // Mobile Render
  // ==========================================================================
  if (isMobile) {
    return (
      <div className="flex flex-col bg-white" style={{ height: '100dvh' }}>
        {/* Mobile header */}
        <div className="flex-shrink-0 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-2 px-3 py-2.5">
            <Link to="/" className="flex-shrink-0 rounded p-1.5 text-gray-400 hover:text-gray-600">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-semibold text-gray-900">{project?.name || 'Project'}</h2>
            </div>
            {isConnected && <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500" title="Live" />}
            <button
              onClick={() => setMobileActionsOpen(!mobileActionsOpen)}
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
              </svg>
            </button>
            <button
              onClick={handleDeploy}
              disabled={isDeploying || isBuilding || files.length === 0}
              className="flex-shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-40"
            >
              {isDeploying ? 'Deploying...' : 'Deploy'}
            </button>
          </div>
          {mobileActionsOpen && (
            <div className="flex gap-2 overflow-x-auto border-t border-gray-100 px-3 py-2">
              {project?.github_repo_url ? (
                <>
                  <button onClick={handleGitHubPush} disabled={gitPushing} className="flex-shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 disabled:opacity-50">{gitPushing ? 'Pushing...' : 'Push'}</button>
                  <button onClick={handleGitHubPull} disabled={gitPulling} className="flex-shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 disabled:opacity-50">{gitPulling ? 'Pulling...' : 'Pull'}</button>
                </>
              ) : (
                <button onClick={() => setShowGitHubModal(true)} className="flex-shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600">GitHub</button>
              )}
              {project?.deployment_url && (
                <Link to={`/project/${projectId}/marketing`} className="flex-shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600">Marketing</Link>
              )}
            </div>
          )}
        </div>

        {/* Build progress */}
        <BuildProgressBar
          isBuilding={isBuilding}
          buildSuccess={buildSuccess}
          buildError={buildError}
          progress={progress}
          stage={stage}
          progressMessage={progressMessage || latestProgressMessage.current}
        />

        {/* Active panel */}
        <div className="flex-1 overflow-hidden">
          {mobilePanel === 'chat' && (
            <div className="flex h-full flex-col">
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {messages.length === 0 && !detectedSecrets && (
                  <div className="flex h-full flex-col items-center justify-center">
                    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50">
                      <svg className="h-7 w-7 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                      </svg>
                    </div>
                    <h3 className="mb-2 text-base font-semibold text-gray-800">What would you like to build?</h3>
                    <p className="max-w-xs text-center text-sm text-gray-400">Describe your app idea and the AI will generate the code.</p>
                    <div className="mt-5 flex flex-wrap justify-center gap-2">
                      {['A task tracker app', 'A landing page', 'A REST API'].map((s) => (
                        <button key={s} onClick={() => setPrompt(s)} className="rounded-full border border-gray-200 px-4 py-2.5 text-xs text-gray-500 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600">{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-4">
                  {/* Collapsed timeline checkpoints for older messages */}
                  {timeline.checkpoints.map((cp) => (
                    <TimelineCheckpoint key={cp.label} checkpoint={cp} />
                  ))}
                  {/* Today's divider if there are checkpoints */}
                  {timeline.checkpoints.length > 0 && timeline.recentMessages.length > 0 && (
                    <div className="flex items-center gap-3 py-1">
                      <div className="flex-1 border-b border-gray-200" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Today</span>
                      <div className="flex-1 border-b border-gray-200" />
                    </div>
                  )}
                  {/* Recent messages shown individually */}
                  {timeline.recentMessages.map((msg, i) => (
                    <MessageBubble key={msg.id || i} message={msg} />
                  ))}
                  {detectedSecrets && detectedSecrets.length > 0 && (
                    <SecretsDetectionCard detectedSecrets={detectedSecrets} secretValues={secretValues} onSecretChange={setSecretValues} onSubmit={handleSubmitSecrets} onDismiss={dismissSecrets} isSaving={isSending} />
                  )}
                  {(isSending || isBuilding) && !detectedSecrets && (
                    <div className="flex justify-start">
                      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-gray-100 px-4 py-3">
                        <div className="flex items-center gap-2">
                          <svg className="h-4 w-4 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          <span className="text-sm text-gray-600">{progressMessage || (isSending ? 'Processing...' : 'Working...')}</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div ref={messagesEndRef} />
              </div>

              {/* Chat input */}
              <form onSubmit={handleSend} className="flex-shrink-0 border-t border-gray-200 bg-white px-3 py-3">
                {pendingAttachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingAttachments.map((file, idx) => (
                      <AttachmentPreview key={`${file.name}-${idx}`} file={file} onRemove={() => removeAttachment(idx)} />
                    ))}
                  </div>
                )}
                <div className="mb-2">
                  <ModelSelector
                    selectedModel={selectedModel}
                    onSelectModel={setSelectedModel}
                    isOpen={modelDropdownOpen}
                    onToggle={() => setModelDropdownOpen(!modelDropdownOpen)}
                    compact
                  />
                </div>
                <div className="flex items-end gap-2">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isBuilding} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-400 disabled:opacity-40">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
                    </svg>
                  </button>
                  <input ref={fileInputRef} type="file" multiple accept="image/*,audio/*,video/*" onChange={handleFileSelect} className="hidden" />
                  <div className="relative flex-1">
                    <textarea
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={placeholder}
                      rows={1}
                      disabled={isBuilding}
                      className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-800 placeholder-gray-400 focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:opacity-50"
                      style={{ minHeight: '44px', maxHeight: '120px' }}
                      onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
                    />
                  </div>
                  <button type="submit" disabled={!prompt.trim() || isSending || isBuilding} className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white disabled:opacity-40">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  </button>
                </div>
              </form>
            </div>
          )}
          {mobilePanel === 'preview' && <PreviewTab project={project} files={files} />}
          {mobilePanel === 'files' && (
            <FilesTab files={files} selectedFile={selectedFile} onSelectFile={setSelectedFile} collapsedFolders={collapsedFolders} onToggleFolder={toggleFolder} mobileMode />
          )}
          {mobilePanel === 'secrets' && (
            <SecretsTab secrets={secrets} newSecret={newSecret} onNewSecretChange={setNewSecret} onAddSecret={handleAddSecret} onDeleteSecret={handleDeleteSecret} onDetect={handleDetectSecrets} detecting={detecting} detectedSecrets={fileDetectedSecrets} onAddDetected={handleAddDetectedSecret} />
          )}
          {mobilePanel === 'domains' && (
            <DomainsTab domains={domains} onAddDomain={handleAddDomain} onRemoveDomain={handleRemoveDomain} onRefreshStatus={handleRefreshDomainStatus} deploymentUrl={project?.deployment_url} />
          )}
        </div>

        {/* Bottom tab bar */}
        <MobileTabBar activePanel={mobilePanel} onPanelChange={setMobilePanel} fileCount={files.length} secretCount={secrets.length} domainCount={domains.length} />

        {/* GitHub Modal */}
        {showGitHubModal && (
          <GitHubModal onClose={() => setShowGitHubModal(false)} onCreateRepo={handleCreateRepo} onConnectGitHub={handleConnectGitHub} repoName={gitRepoName} onRepoNameChange={setGitRepoName} isPrivate={gitIsPrivate} onPrivateChange={setGitIsPrivate} projectName={project?.name} />
        )}
      </div>
    );
  }

  // ==========================================================================
  // Desktop Render
  // ==========================================================================
  return (
    <div ref={containerRef} className="flex h-[calc(100vh-4rem)] gap-0 bg-gray-50">
      {/* ================================================================== */}
      {/* LEFT PANEL -- Chat */}
      {/* ================================================================== */}
      <div style={{ width: `${chatWidth}%` }} className="flex flex-shrink-0 flex-col border-r border-gray-200 bg-white">
        {/* -- Header -- */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-gray-900">
              {project?.name || 'Project'}
            </h2>
            <p className="text-xs text-gray-400">
              {project?.app_type ? project.app_type : 'Chat with AI to build your app'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isConnected && (
              <span className="flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-600">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                Live
              </span>
            )}

            {/* GitHub button */}
            {project?.github_repo_url ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={handleGitHubPush}
                  disabled={gitPushing}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  title="Push to GitHub"
                >
                  {gitPushing && <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />}
                  {gitPushing ? 'Pushing...' : 'Push'}
                </button>
                <button
                  onClick={handleGitHubPull}
                  disabled={gitPulling}
                  className="flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:opacity-50"
                  title="Pull from GitHub"
                >
                  {gitPulling && <span className="h-3 w-3 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600" />}
                  {gitPulling ? 'Pulling...' : 'Pull'}
                </button>
                {githubStatus?.status && githubStatus.status !== 'not_connected' && (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    githubStatus.status === 'synced'
                      ? 'bg-green-50 text-green-600'
                      : githubStatus.status === 'diverged'
                        ? 'bg-yellow-50 text-yellow-600'
                        : 'bg-gray-100 text-gray-500'
                  }`}>
                    {githubStatus.status}
                  </span>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowGitHubModal(true)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
                </svg>
                GitHub
              </button>
            )}

            {/* Marketing link */}
            {project?.deployment_url && (
              <Link
                to={`/project/${projectId}/marketing`}
                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
              >
                Marketing
              </Link>
            )}

            {/* Deploy button */}
            <button
              onClick={handleDeploy}
              disabled={isDeploying || isBuilding || files.length === 0}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-emerald-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isDeploying ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Deploying...
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
                  </svg>
                  Deploy
                </>
              )}
            </button>
          </div>
        </div>

        {/* -- Progress bar -- */}
        <BuildProgressBar
          isBuilding={isBuilding}
          buildSuccess={buildSuccess}
          buildError={buildError}
          progress={progress}
          stage={stage}
          progressMessage={progressMessage || latestProgressMessage.current}
        />

        {/* -- Messages -- */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Empty state */}
          {messages.length === 0 && !detectedSecrets && (
            <div className="flex h-full flex-col items-center justify-center">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50">
                <svg className="h-8 w-8 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
                </svg>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-gray-800">What would you like to build?</h3>
              <p className="max-w-sm text-center text-sm text-gray-400">
                Describe your app idea and the AI will generate the code, configure the project, and prepare it for deployment.
              </p>
              <div className="mt-6 flex flex-wrap justify-center gap-2">
                {['A task tracker app', 'A landing page with CTA', 'A REST API with auth'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setPrompt(s)}
                    className="rounded-full border border-gray-200 px-3.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message bubbles */}
          <div className="space-y-4">
            {/* Collapsed timeline checkpoints for older messages */}
            {timeline.checkpoints.map((cp) => (
              <TimelineCheckpoint key={cp.label} checkpoint={cp} />
            ))}
            {/* Today's divider if there are checkpoints */}
            {timeline.checkpoints.length > 0 && timeline.recentMessages.length > 0 && (
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 border-b border-gray-200" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Today</span>
                <div className="flex-1 border-b border-gray-200" />
              </div>
            )}
            {/* Recent messages shown individually */}
            {timeline.recentMessages.map((msg, i) => (
              <MessageBubble key={msg.id || i} message={msg} />
            ))}

            {/* Secrets detection card */}
            {detectedSecrets && detectedSecrets.length > 0 && (
              <SecretsDetectionCard
                detectedSecrets={detectedSecrets}
                secretValues={secretValues}
                onSecretChange={setSecretValues}
                onSubmit={handleSubmitSecrets}
                onDismiss={dismissSecrets}
                isSaving={isSending}
              />
            )}

            {/* Thinking / progress indicator */}
            {(isSending || isBuilding) && !detectedSecrets && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-gray-100 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <svg className="h-4 w-4 animate-spin text-indigo-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <span className="text-sm text-gray-600">
                      {progressMessage || (isSending ? 'Processing your request...' : 'Working...')}
                    </span>
                  </div>
                  {isBuilding && progress > 0 && progress < 100 && (
                    <div className="mt-2">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-gray-400">{progress}% complete</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div ref={messagesEndRef} />
        </div>

        {/* -- Input area -- */}
        <form
          onSubmit={handleSend}
          className="border-t border-gray-200 bg-white px-6 py-4"
        >
          {/* Pending attachment previews */}
          {pendingAttachments.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {pendingAttachments.map((file, idx) => (
                <AttachmentPreview key={`${file.name}-${idx}`} file={file} onRemove={() => removeAttachment(idx)} />
              ))}
            </div>
          )}

          {/* Model selector */}
          <div className="mb-2">
            <ModelSelector
              selectedModel={selectedModel}
              onSelectModel={setSelectedModel}
              isOpen={modelDropdownOpen}
              onToggle={() => setModelDropdownOpen(!modelDropdownOpen)}
            />
          </div>

          <div className="flex items-end gap-3">
            {/* Attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBuilding}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-gray-50 text-gray-400 transition-all hover:border-gray-300 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
              title="Attach files (images, audio, video)"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13" />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,audio/*,video/*"
              onChange={handleFileSelect}
              className="hidden"
            />

            <div className="relative flex-1">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                rows={1}
                disabled={isBuilding}
                className="w-full resize-none rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 pr-12 text-sm leading-relaxed text-gray-800 placeholder-gray-400 transition-colors focus:border-indigo-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                style={{ minHeight: '44px', maxHeight: '120px' }}
                onInput={(e) => {
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
              />
            </div>
            <button
              type="submit"
              disabled={!prompt.trim() || isSending || isBuilding}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:shadow-sm"
            >
              {isUploading ? (
                <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              )}
            </button>
          </div>
          {isBuilding && (
            <p className="mt-2 text-center text-xs text-gray-400">
              Build in progress -- input disabled until it completes.
            </p>
          )}
        </form>
      </div>

      {/* ================================================================== */}
      {/* DRAG HANDLE */}
      {/* ================================================================== */}
      <div
        onMouseDown={handleDragStart}
        className="group relative z-10 flex w-1.5 flex-shrink-0 cursor-col-resize items-center justify-center hover:bg-indigo-50 active:bg-indigo-100"
        title="Drag to resize"
      >
        <div className="h-8 w-0.5 rounded-full bg-gray-300 transition-colors group-hover:bg-indigo-400 group-active:bg-indigo-500" />
      </div>

      {/* ================================================================== */}
      {/* RIGHT PANEL */}
      {/* ================================================================== */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        {/* -- Tab bar -- */}
        <div className="flex border-b border-gray-200">
          {[
            { key: 'preview', label: 'Preview' },
            { key: 'files', label: 'Files' },
            { key: 'secrets', label: 'Secrets' },
            { key: 'settings', label: 'Settings' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`relative flex-1 px-4 py-3 text-center text-sm font-medium transition-colors ${
                activeTab === key
                  ? 'text-indigo-600'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {label}
              {key === 'files' && files.length > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-500">
                  {files.length}
                </span>
              )}
              {key === 'secrets' && secrets.length > 0 && (
                <span className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-gray-100 px-1.5 text-[10px] font-semibold text-gray-500">
                  {secrets.length}
                </span>
              )}
              {activeTab === key && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-indigo-600" />
              )}
            </button>
          ))}
        </div>

        {/* -- Tab content -- */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'preview' && <PreviewTab project={project} files={files} />}
          {activeTab === 'files' && (
            <FilesTab
              files={files}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              collapsedFolders={collapsedFolders}
              onToggleFolder={toggleFolder}
            />
          )}
          {activeTab === 'secrets' && (
            <SecretsTab
              secrets={secrets}
              newSecret={newSecret}
              onNewSecretChange={setNewSecret}
              onAddSecret={handleAddSecret}
              onDeleteSecret={handleDeleteSecret}
              onDetect={handleDetectSecrets}
              detecting={detecting}
              detectedSecrets={fileDetectedSecrets}
              onAddDetected={handleAddDetectedSecret}
            />
          )}
          {activeTab === 'settings' && (
            <SettingsTab
              project={project}
              onUpdateProject={async (updates) => {
                const result = await updateProject(projectId, updates);
                setProject(result.project || result);
              }}
              domains={domains}
              onAddDomain={handleAddDomain}
              onRemoveDomain={handleRemoveDomain}
              onRefreshStatus={handleRefreshDomainStatus}
            />
          )}
        </div>
      </div>

      {/* GitHub Modal */}
      {showGitHubModal && (
        <GitHubModal
          onClose={() => setShowGitHubModal(false)}
          onCreateRepo={handleCreateRepo}
          onConnectGitHub={handleConnectGitHub}
          repoName={gitRepoName}
          onRepoNameChange={setGitRepoName}
          isPrivate={gitIsPrivate}
          onPrivateChange={setGitIsPrivate}
          projectName={project?.name}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-200">
          <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg backdrop-blur-sm ${
            toast.type === 'success' ? 'border-emerald-200 bg-emerald-50/95 text-emerald-800' :
            toast.type === 'error' ? 'border-red-200 bg-red-50/95 text-red-800' :
            'border-blue-200 bg-blue-50/95 text-blue-800'
          }`}>
            <div className="mt-0.5">
              {toast.type === 'success' && (
                <svg className="h-4 w-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {toast.type === 'error' && (
                <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {toast.type === 'info' && (
                <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium">{toast.message}</p>
              {toast.detail && <p className="mt-0.5 text-xs opacity-75">{toast.detail}</p>}
            </div>
            <button onClick={() => setToast(null)} className="ml-2 -mr-1 rounded-md p-0.5 opacity-50 hover:opacity-100">
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

// ---------- Build Progress Bar ------------------------------------------------

function BuildProgressBar({ isBuilding, buildSuccess, buildError, progress, stage }) {
  if (!isBuilding && !buildSuccess && !buildError) return null;

  // Success state
  if (buildSuccess) {
    return (
      <div className="border-b border-green-100 bg-green-50 px-6 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-green-700">Build completed successfully!</span>
        </div>
      </div>
    );
  }

  // Error state
  if (buildError) {
    return (
      <div className="border-b border-red-100 bg-red-50 px-6 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm font-medium text-red-700">Build failed. Check messages for details.</span>
        </div>
      </div>
    );
  }

  // In-progress state
  const pct = Math.max(0, Math.min(100, progress));
  return (
    <div className="border-b border-indigo-100 bg-indigo-50/50 px-6 py-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium text-indigo-700">{stage || 'Building...'}</span>
        <span className="text-xs tabular-nums text-indigo-400">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-indigo-100">
        <div
          className="h-full rounded-full bg-indigo-500 transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------- Message Bubble ----------------------------------------------------

function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const isError = message.metadata?.error;
  const parts = useMemo(() => parseContent(message.content), [message.content]);
  const time = fmtTime(message.created_at);
  const attachments = message.attachments || [];
  const extractedUrls = message.extracted_urls || [];

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Attachment media */}
        {attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-2">
            {attachments.map((att) => (
              <MessageAttachment key={att.id} attachment={att} isUser={isUser} />
            ))}
          </div>
        )}

        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'rounded-br-md bg-indigo-600 text-white'
              : isError
                ? 'rounded-bl-md border border-red-200 bg-red-50 text-red-800'
                : 'rounded-bl-md bg-gray-100 text-gray-800'
          }`}
        >
          {parts.map((part, i) =>
            part.type === 'code' ? (
              <div key={i} className="my-2 first:mt-0 last:mb-0">
                {part.lang && part.lang !== 'text' && (
                  <div className="flex items-center rounded-t-lg bg-gray-800 px-3 py-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-wider text-gray-400">
                      {part.lang}
                    </span>
                  </div>
                )}
                <pre
                  className={`overflow-x-auto bg-gray-900 p-3 text-xs leading-relaxed text-gray-100 ${
                    part.lang && part.lang !== 'text' ? 'rounded-b-lg' : 'rounded-lg'
                  }`}
                >
                  <code>{part.value}</code>
                </pre>
              </div>
            ) : (
              <p key={i} className="whitespace-pre-wrap">
                {part.value}
              </p>
            ),
          )}
        </div>

        {/* Extracted URL chips */}
        {extractedUrls.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {extractedUrls.map((eu) => (
              <span
                key={eu.url}
                className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-1 text-[10px] font-medium text-indigo-600"
                title={eu.url}
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                {eu.title || new URL(eu.url).hostname}
              </span>
            ))}
          </div>
        )}

        {time && (
          <span className={`mt-1 text-[10px] ${isUser ? 'text-gray-300' : 'text-gray-400'}`}>
            {time}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- Timeline Checkpoint (collapsible older messages) ------------------

function TimelineCheckpoint({ checkpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="group flex w-full items-center gap-3 py-2"
      >
        {/* Timeline line + dot */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-gray-300 bg-white group-hover:border-indigo-400 transition-colors">
            <svg className={`h-3 w-3 text-gray-400 group-hover:text-indigo-500 transition-all ${expanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500">{checkpoint.label}</span>
            <span className="text-[10px] text-gray-400">
              {checkpoint.messageCount} message{checkpoint.messageCount !== 1 ? 's' : ''}
            </span>
          </div>
          <p className="truncate text-xs text-gray-400 mt-0.5">{checkpoint.summary}</p>
        </div>

        {/* Expand indicator */}
        <span className="text-[10px] text-gray-400 flex-shrink-0 group-hover:text-indigo-500">
          {expanded ? 'Collapse' : 'Expand'}
        </span>
      </button>

      {/* Expanded messages */}
      {expanded && (
        <div className="ml-3 border-l-2 border-gray-200 pl-5 space-y-3 py-2">
          {checkpoint.messages.map((msg, i) => (
            <MessageBubble key={msg.id || i} message={msg} />
          ))}
        </div>
      )}

      {/* Divider line */}
      {!expanded && (
        <div className="mx-3 border-b border-dashed border-gray-200" />
      )}
    </div>
  );
}

// ---------- Message Attachment (in bubble) ------------------------------------

function MessageAttachment({ attachment, isUser }) {
  const url = attachment._localUrl || attachment.storage_url;
  const category = attachment.category || (attachment.mime_type?.startsWith('image/') ? 'image' : attachment.mime_type?.startsWith('audio/') ? 'audio' : 'video');

  if (category === 'image') {
    return (
      <div className="overflow-hidden rounded-xl">
        <img
          src={url}
          alt={attachment.filename}
          className="max-h-64 max-w-full rounded-xl object-cover"
          loading="lazy"
        />
      </div>
    );
  }

  if (category === 'audio') {
    return (
      <div className={`flex items-center gap-2 rounded-xl px-3 py-2 ${isUser ? 'bg-indigo-500/30' : 'bg-gray-200'}`}>
        <svg className={`h-4 w-4 flex-shrink-0 ${isUser ? 'text-indigo-200' : 'text-gray-500'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
        <audio controls className="h-8 max-w-[220px]" preload="metadata">
          <source src={url} type={attachment.mime_type} />
        </audio>
        <span className={`truncate text-[10px] ${isUser ? 'text-indigo-200' : 'text-gray-500'}`}>{attachment.filename}</span>
      </div>
    );
  }

  if (category === 'video') {
    return (
      <div className="overflow-hidden rounded-xl">
        <video controls className="max-h-64 max-w-full rounded-xl" preload="metadata">
          <source src={url} type={attachment.mime_type} />
        </video>
      </div>
    );
  }

  return null;
}

// ---------- Attachment Preview (pending, in input area) ----------------------

function AttachmentPreview({ file, onRemove }) {
  const isImage = file.type.startsWith('image/');
  const isAudio = file.type.startsWith('audio/');
  const isVideo = file.type.startsWith('video/');
  const previewUrl = useMemo(() => (isImage ? URL.createObjectURL(file) : null), [file, isImage]);

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5">
      {isImage && previewUrl && (
        <img src={previewUrl} alt={file.name} className="h-8 w-8 rounded object-cover" />
      )}
      {isAudio && (
        <svg className="h-5 w-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
      )}
      {isVideo && (
        <svg className="h-5 w-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
        </svg>
      )}
      <span className="max-w-[120px] truncate text-xs text-gray-600">{file.name}</span>
      <span className="text-[10px] text-gray-400">
        {file.size < 1024 * 1024
          ? `${(file.size / 1024).toFixed(0)} KB`
          : `${(file.size / (1024 * 1024)).toFixed(1)} MB`}
      </span>
      <button
        onClick={onRemove}
        className="ml-1 rounded-full p-0.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
        title="Remove"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

// ---------- Secrets Detection Card -------------------------------------------

function SecretsDetectionCard({
  detectedSecrets,
  secretValues,
  onSecretChange,
  onSubmit,
  onDismiss,
  isSaving,
}) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100">
          <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-amber-900">Secrets Required</h3>
          <p className="mt-0.5 text-xs text-amber-700/70">
            These values are stored encrypted and never sent to AI.
          </p>
        </div>
      </div>

      {/* Secret inputs */}
      <div className="space-y-3">
        {detectedSecrets.map((secret) => (
          <div key={secret.key} className="rounded-lg bg-white/60 p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="text-xs font-medium text-gray-700">
                {secret.label || secret.key}
              </span>
              <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                LANG_COLORS[secret.type] || 'bg-gray-200 text-gray-600'
              }`}>
                {(secret.type || 'api_key').replace(/_/g, ' ')}
              </span>
            </div>
            <input
              type="password"
              value={secretValues[secret.key]?.value || ''}
              onChange={(e) =>
                onSecretChange((prev) => ({
                  ...prev,
                  [secret.key]: { ...prev[secret.key], value: e.target.value },
                }))
              }
              className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm placeholder-gray-400 transition-colors focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100"
              placeholder={`Enter ${secret.label || secret.key}`}
            />
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <button
          onClick={onSubmit}
          disabled={isSaving}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-amber-700 hover:shadow-md disabled:opacity-50"
        >
          {isSaving ? (
            <span className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving...
            </span>
          ) : (
            'Save Secrets & Continue'
          )}
        </button>
        <button
          onClick={onDismiss}
          disabled={isSaving}
          className="rounded-lg px-4 py-2 text-sm text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------- Preview Tab -------------------------------------------------------

function PreviewTab({ project, files }) {
  const deployUrl = project?.deployment_url || project?.deploymentUrl;
  const fileList = Array.isArray(files) ? files : [];
  const [refreshKey, setRefreshKey] = useState(0);

  // Parse package.json dependencies and build esm.sh import map
  const { importMapJson, depsCssLinks } = useMemo(() => {
    const pkgFile = fileList.find(f => (f.file_path || f.path || '') === 'package.json');
    const imports = {
      'react': 'https://esm.sh/react@18?dev',
      'react/': 'https://esm.sh/react@18&dev/',
      'react-dom': 'https://esm.sh/react-dom@18?dev&deps=react@18',
      'react-dom/': 'https://esm.sh/react-dom@18&dev&deps=react@18/',
      'react-dom/client': 'https://esm.sh/react-dom@18/client?dev&deps=react@18',
    };
    const cssLinks = [];
    if (pkgFile?.content) {
      try {
        const pkg = JSON.parse(pkgFile.content);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        // Built-in shims we handle ourselves — don't fetch from esm.sh
        const shimmed = new Set(['react', 'react-dom', 'next', 'next/link', 'next/image', 'next/navigation', 'next/router']);
        for (const [name, version] of Object.entries(deps)) {
          if (shimmed.has(name)) continue;
          // Clean version (strip ^, ~, >=, etc.)
          const cleanVer = version.replace(/^[\^~>=<]+/, '');
          const esmUrl = `https://esm.sh/${name}@${cleanVer}?deps=react@18,react-dom@18`;
          imports[name] = esmUrl;
          // Also map subpath imports (e.g. "lucide-react/dist/...")
          imports[name + '/'] = `https://esm.sh/${name}@${cleanVer}&deps=react@18,react-dom@18/`;
          // If the package has CSS (common UI libs), add a link
          const cssPackages = ['tailwindcss', '@tailwindcss/typography'];
          if (cssPackages.includes(name)) {
            cssLinks.push(`https://esm.sh/${name}@${cleanVer}?css`);
          }
        }
      } catch { /* ignore parse errors */ }
    }
    return { importMapJson: JSON.stringify({ imports }, null, 2), depsCssLinks: cssLinks };
  }, [fileList]);

  // Build an in-browser preview using import maps + esm.sh for npm deps
  const previewHtml = useMemo(() => {
    if (fileList.length === 0) return null;

    // Gather files by path
    const fileMap = {};
    for (const f of fileList) {
      const path = f.file_path || f.path || '';
      fileMap[path] = f.content || '';
    }

    // Find CSS — check many common locations
    const cssKeys = Object.keys(fileMap).filter(k => /\.(css|scss)$/.test(k)).sort();
    const primaryCssKey = ['src/index.css', 'src/globals.css', 'src/app/globals.css', 'src/styles/globals.css', 'styles/globals.css', 'app/globals.css', 'index.css', 'globals.css']
      .find(k => fileMap[k]) || cssKeys[0] || '';
    const indexCss = fileMap[primaryCssKey] || '';

    // Clean CSS for embedding
    const cleanCss = indexCss
      .replace(/@tailwind\s+\w+;/g, '')
      .replace(/@import\s+.*$/gm, '')
      .replace(/@layer\s+\w+\s*\{[\s\S]*?\}/g, '')
      .replace(/@apply\s+[^;]+;/g, '');

    // Helper: extract a valid JS identifier from a file path
    const toIdentifier = (path) => {
      const basename = path.split('/').pop();
      return basename.replace(/\.(jsx|tsx|js|ts)$/, '').replace(/[^a-zA-Z0-9]/g, '');
    };

    // Rewrite imports: convert relative imports to inline refs, keep npm imports for import map
    const rewriteImports = (code, name) => {
      let c = code;
      // Remove TypeScript type imports entirely
      c = c.replace(/^import\s+type\s+.*$/gm, '');
      // Remove CSS/SCSS/style imports (handled separately)
      c = c.replace(/^import\s+['"].*\.(css|scss|sass|less)['"];?\s*$/gm, '');
      // Convert relative imports to destructured refs (these are our own components)
      // e.g. import Foo from './Foo' → /* resolved: Foo */
      // e.g. import { Bar } from '../components/Bar' → /* resolved: Bar */
      c = c.replace(/^import\s+.*from\s+['"]\.\.?\/.*['"];?\s*$/gm, '/* local import resolved */');
      // Convert "export default function Foo" → "function Foo"
      c = c.replace(/^export\s+default\s+function\s+/gm, 'function ');
      // Convert "export default" → "const Name ="
      c = c.replace(/^export\s+default\s+/gm, `const ${name} = `);
      // Convert named exports → const
      c = c.replace(/^export\s+(const|let|var|function|class)\s+/gm, '$1 ');
      c = c.replace(/^export\s+\{[^}]*\};?\s*$/gm, '');
      return c;
    };

    // Collect all npm imports from all files — parse into structured data
    // so we can generate dynamic import() calls instead of static imports
    const npmImportEntries = []; // { pkg, defaultName, namedImports: ['a','b'], namespaceImport: 'ns' }
    const seenImports = new Set(); // dedup
    for (const f of fileList) {
      const content = f.content || '';
      const importRegex = /^import\s+(.*?)\s+from\s+['"]([^.'"][^'"]*?)['"];?\s*$/gm;
      let m;
      while ((m = importRegex.exec(content)) !== null) {
        const clause = m[1].trim();
        const pkg = m[2];
        if (pkg.startsWith('.') || /\.(css|scss|sass|less)$/.test(pkg)) continue;
        // Skip react/react-dom — loaded separately
        if (pkg === 'react' || pkg === 'react-dom' || pkg === 'react-dom/client') continue;
        const key = `${clause}::${pkg}`;
        if (seenImports.has(key)) continue;
        seenImports.add(key);

        const entry = { pkg, defaultName: null, namedImports: [], namespaceImport: null };
        // Parse: import * as ns from 'pkg'
        const nsMatch = clause.match(/^\*\s+as\s+(\w+)$/);
        if (nsMatch) { entry.namespaceImport = nsMatch[1]; npmImportEntries.push(entry); continue; }
        // Parse: import { a, b as c } from 'pkg' OR import Default, { a, b } from 'pkg'
        const parts = clause.replace(/\s+/g, ' ');
        const braceMatch = parts.match(/\{([^}]*)\}/);
        if (braceMatch) {
          entry.namedImports = braceMatch[1].split(',').map(s => s.trim()).filter(Boolean);
        }
        const beforeBrace = parts.replace(/\{[^}]*\}/, '').replace(/,/g, '').trim();
        if (beforeBrace) entry.defaultName = beforeBrace;
        npmImportEntries.push(entry);
      }
    }

    // Build dynamic import lines:
    // const { named1, named2 } = await import('pkg').catch(() => ({}));
    // const DefaultName = (await import('pkg').catch(() => ({}))).default || (await import('pkg').catch(() => ({})));
    const dynamicImportLines = npmImportEntries.map(({ pkg, defaultName, namedImports, namespaceImport }) => {
      const escapedPkg = pkg.replace(/'/g, "\\'");
      if (namespaceImport) {
        return `const ${namespaceImport} = await import('${escapedPkg}').catch(() => ({}));`;
      }
      const lines = [];
      if (defaultName && namedImports.length > 0) {
        lines.push(`const _mod_${defaultName} = await import('${escapedPkg}').catch(() => ({}));`);
        lines.push(`const ${defaultName} = _mod_${defaultName}.default || _mod_${defaultName};`);
        // Handle "as" aliases in named imports
        const destructure = namedImports.map(n => {
          const asMatch = n.match(/^(\w+)\s+as\s+(\w+)$/);
          return asMatch ? `${asMatch[1]}: ${asMatch[2]}` : n;
        }).join(', ');
        lines.push(`const { ${destructure} } = _mod_${defaultName};`);
      } else if (defaultName) {
        lines.push(`const _mod_${defaultName} = await import('${escapedPkg}').catch(() => ({}));`);
        lines.push(`const ${defaultName} = _mod_${defaultName}.default || _mod_${defaultName};`);
      } else if (namedImports.length > 0) {
        const destructure = namedImports.map(n => {
          const asMatch = n.match(/^(\w+)\s+as\s+(\w+)$/);
          return asMatch ? `${asMatch[1]}: ${asMatch[2]}` : n;
        }).join(', ');
        lines.push(`const { ${destructure} } = await import('${escapedPkg}').catch(() => ({}));`);
      }
      return lines.join('\n      ');
    });

    // Collect ALL JS/JSX/TS/TSX files as potential components
    // Skip config files, test files, and entry points that just mount
    const skipPatterns = [
      /node_modules\//,
      /\.(test|spec|stories|d)\.(js|jsx|ts|tsx)$/,
      /\.(config|setup)\.(js|ts|mjs|cjs)$/,
      /(vite|webpack|babel|jest|tailwind|postcss|tsconfig|next)\./,
      /\.env/,
      /package\.json$/,
      /README/i,
      /LICENSE/i,
    ];
    const entryFilePatterns = [
      /^(src\/)?(main|index)\.(jsx|tsx|js|ts)$/,
    ];

    const collected = new Map();
    for (const f of fileList) {
      const path = f.file_path || f.path || '';
      if (!f.content) continue;
      // Only JS/JSX/TS/TSX files
      if (!/\.(jsx|tsx|js|ts)$/.test(path)) continue;
      // Skip non-component files
      if (skipPatterns.some(p => p.test(path))) continue;
      // Skip entry files that just mount (e.g. main.jsx, index.js)
      if (entryFilePatterns.some(p => p.test(path))) continue;

      const name = toIdentifier(path);
      if (!name) continue;

      // Determine if this is a "page" (entry-level component) or a supporting component
      const isPage = /\b(pages?|views?|screens?|routes?|app)\b/i.test(path)
        || /^(src\/)?App\.(jsx|tsx|js|ts)$/.test(path)
        || /^(src\/)?[^/]+\.(jsx|tsx)$/.test(path); // root-level JSX files are likely pages

      const hasExt = /\.(jsx|tsx)$/.test(path);
      const priority = hasExt ? 1 : 0;
      const existing = collected.get(name);
      if (existing && existing.priority >= priority) continue;

      collected.set(name, {
        code: rewriteImports(f.content, name),
        priority,
        isPage,
      });
    }

    // Split into components and pages
    const componentScripts = [];
    const pageScripts = [];
    const pageNames = [];
    for (const [name, { code, isPage }] of collected) {
      if (isPage) {
        pageScripts.push(code);
        pageNames.push(name);
      } else {
        componentScripts.push(code);
      }
    }

    // If no pages found, promote all components to pages (best effort)
    if (pageNames.length === 0 && componentScripts.length > 0) {
      for (const [name, { code }] of collected) {
        pageScripts.push(code);
        pageNames.push(name);
      }
      componentScripts.length = 0;
    }

    if (pageNames.length === 0) return null;

    // Find the best page to render — prefer App, then common page names
    const homePage = ['App', 'Home', 'Index', 'Page', 'Main', 'Root', 'Layout', 'Dashboard'].find(n => pageNames.includes(n)) || pageNames[0] || '';

    // Escape for embedding in script
    const escapeForScript = (str) => str
      .replace(/\\/g, '\\\\')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$')
      .replace(/<\/script>/gi, '<\\/script>');

    const allComponentCode = [...componentScripts, ...pageScripts].join('\n\n');

    // Build render expression
    const renderExpr = homePage
      ? `typeof ${homePage} === 'function' ? React.createElement(${homePage}) : null`
      : pageNames.length > 0
        ? pageNames.map(n => `typeof ${n} === 'function' ? React.createElement(${n}) : null`).join(' || ') + ' || null'
        : 'null';

    // CSS links for deps
    const cssLinkTags = depsCssLinks.map(url => `<link rel="stylesheet" href="${url}" />`).join('\n  ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Preview</title>
  <script type="importmap">${importMapJson}<\/script>
  <script src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"><\/script>
  <script src="https://cdn.tailwindcss.com"><\/script>
  ${cssLinkTags}
  <style>${escapeForScript(cleanCss)}</style>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    img[src=""], img:not([src]) { display: inline-block; background: #e5e7eb; min-height: 40px; min-width: 40px; }
    #loading { display: flex; align-items: center; justify-content: center; height: 100vh; color: #9ca3af; font-size: 14px; flex-direction: column; gap: 8px; }
    #loading .spinner { width: 24px; height: 24px; border: 3px solid #e5e7eb; border-top-color: #6366f1; border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    #timeout-msg { display: none; text-align: center; padding: 2rem; color: #6b7280; }
    #timeout-msg h3 { font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 4px; }
    #timeout-msg p { font-size: 12px; }
  </style>
</head>
<body>
  <div id="root"><div id="loading"><div class="spinner"></div>Loading preview...</div></div>
  <div id="timeout-msg"><h3>Preview not available</h3><p>This project may need to be deployed for a full preview.</p></div>
  <div id="err" style="display:none;padding:1rem;color:#dc2626;font-size:13px;font-family:monospace;white-space:pre-wrap;background:#fef2f2;border-top:2px solid #dc2626;position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow:auto;z-index:9999"></div>
  <script>
    var _rendered = false;
    window.onerror = function(msg, src, line, col, err) { showError(err ? err.stack : msg); };
    window.addEventListener('unhandledrejection', function(e) { showError('Unhandled: ' + (e.reason?.message || e.reason || 'unknown')); });
    function showError(msg) {
      var el = document.getElementById('err');
      el.style.display = 'block';
      el.textContent += msg + '\\n\\n';
      if (!_rendered) {
        document.getElementById('timeout-msg').style.display = 'block';
        var ld = document.getElementById('loading');
        if (ld) ld.style.display = 'none';
      }
    }
    setTimeout(function() {
      if (!_rendered) {
        document.getElementById('timeout-msg').style.display = 'block';
        var ld = document.getElementById('loading');
        if (ld) ld.style.display = 'none';
      }
    }, 15000);
  <\/script>
  <script type="module">
  // Wrap everything in async IIFE + try/catch — module-level errors are invisible to window.onerror
  (async () => {
    try {
      // Step 1: Load React first
      const _reactMod = await import('react').catch(e => { showError('React load failed: ' + e.message); return null; });
      const _reactDomMod = await import('react-dom/client').catch(e => { showError('ReactDOM load failed: ' + e.message); return null; });
      if (!_reactMod || !_reactMod.createElement) { showError('React failed to load from esm.sh CDN'); return; }
      window.React = _reactMod;
      window.ReactDOM = _reactDomMod || {};
      const React = _reactMod;
      const ReactDOM = _reactDomMod || {};
      const { useState, useEffect, useRef, useCallback, useMemo, useContext, useReducer, Fragment, createContext, forwardRef, memo, lazy, Suspense } = React;

      // Step 2: Import npm deps — each can fail independently
      ${dynamicImportLines.join('\n      ')}

      // React Router shims
      const _noop = () => {};
      const _noopNav = () => _noop;
      const BrowserRouter = (p) => p.children;
      const Router = BrowserRouter;
      const HashRouter = BrowserRouter;
      const Routes = (p) => { const arr = React.Children.toArray(p.children); return arr.length ? (arr[0].props.element || arr[0].props.children || null) : null; };
      const Switch = Routes;
      const Route = (p) => p.element || p.children || null;
      const Redirect = () => null;
      const NavLink = (p) => React.createElement('a', { href: p.to || '#', className: typeof p.className === 'function' ? p.className({ isActive: false }) : p.className, onClick: (e) => e.preventDefault() }, p.children);
      const Outlet = () => null;
      const useNavigate = _noopNav;
      const useLocation = () => ({ pathname: '/', search: '', hash: '' });
      const useParams = () => ({});
      const useSearchParams = () => [new URLSearchParams(), _noop];

      // Next.js shims
      const Link = (p) => React.createElement('a', { ...p, href: p.href || p.to || '#', onClick: (e) => e.preventDefault(), to: undefined, legacyBehavior: undefined }, p.children);
      const Image = (p) => React.createElement('img', { src: p.src || '', alt: p.alt || '', width: p.width, height: p.height, className: p.className, style: p.fill ? { objectFit: 'cover', width: '100%', height: '100%' } : undefined });
      const useRouter = () => ({ pathname: '/', query: {}, push: _noop, back: _noop, replace: _noop });
      const usePathname = () => '/';

      // Icon/library fallbacks — Proxy returns stub components for unknown imports
      const _iconProxy = typeof Proxy !== 'undefined' ? new Proxy({}, { get: (_, name) => (props) => React.createElement('span', props) }) : {};

      // Step 3: Babel-transform user JSX → plain JS, then eval
      if (typeof Babel === 'undefined') { showError('Babel failed to load'); return; }

      const jsxCode = \`${escapeForScript(allComponentCode)}

      // Render
      try {
        const _root = ReactDOM.createRoot(document.getElementById('root'));
        const _el = ${escapeForScript(renderExpr)};
        if (_el) {
          window._rendered = true;
          _root.render(_el);
        } else {
          document.getElementById('timeout-msg').style.display = 'block';
          document.getElementById('loading').style.display = 'none';
        }
      } catch(_re) { showError('Render: ' + _re.message + '\\n' + _re.stack); }
      \`;

      try {
        const output = Babel.transform(jsxCode, { presets: ['react'], filename: 'preview.jsx' });
        eval(output.code);
      } catch (babelErr) {
        showError('Transform: ' + babelErr.message + '\\n' + (babelErr.stack || ''));
      }
    } catch (moduleErr) {
      showError('Module: ' + moduleErr.message + '\\n' + (moduleErr.stack || ''));
    }
  })();
  <\/script>
</body>
</html>`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileList, refreshKey, importMapJson, depsCssLinks]);

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  // Toolbar for preview modes
  const renderToolbar = (label, extra) => (
    <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-4 py-2">
      <div className="flex gap-1">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
      </div>
      <div className="flex-1 rounded-md bg-white px-3 py-1 text-xs text-gray-400 truncate border border-gray-200">
        {label}
      </div>
      <button
        onClick={handleRefresh}
        className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
        title="Refresh preview"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
      {extra}
    </div>
  );

  // If there's a deployment URL, show deployed version
  if (deployUrl) {
    return (
      <div className="flex h-full flex-col">
        {renderToolbar(deployUrl, (
          <a
            href={deployUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600"
            title="Open in new tab"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
          </a>
        ))}
        <iframe
          key={refreshKey}
          src={deployUrl}
          title="App Preview"
          className="flex-1 border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    );
  }

  // In-browser preview from generated files
  if (previewHtml) {
    return (
      <div className="flex h-full flex-col">
        {renderToolbar('In-browser preview', (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
            Preview
          </span>
        ))}
        <iframe
          key={refreshKey}
          srcDoc={previewHtml}
          title="App Preview"
          className="flex-1 border-0"
          sandbox="allow-scripts allow-modals"
        />
      </div>
    );
  }

  // No preview — show contextual message
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-100">
        <svg className="h-7 w-7 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
      </div>
      {fileList.length === 0 ? (
        <>
          <h3 className="mb-1.5 text-sm font-semibold text-gray-700">No preview available</h3>
          <p className="max-w-xs text-xs text-gray-400">
            Start chatting with the AI to build your app. A preview will appear here once files are generated.
          </p>
        </>
      ) : (
        <>
          <h3 className="mb-1.5 text-sm font-semibold text-gray-700">Preview not available</h3>
          <p className="max-w-xs text-xs text-gray-400">
            Could not render an in-browser preview. Try deploying the app for a live preview.
          </p>
        </>
      )}
    </div>
  );
}

// ---------- Files Tab ---------------------------------------------------------

function FilesTab({ files, selectedFile, onSelectFile, collapsedFolders, onToggleFolder, mobileMode }) {
  const fileList = Array.isArray(files) ? files : [];
  const tree = useMemo(() => buildFileTree(fileList), [fileList]);
  const [showTree, setShowTree] = useState(true);

  const handleSelectFile = (file) => {
    onSelectFile(file);
    if (mobileMode) setShowTree(false);
  };

  // Code viewer (shared between mobile and desktop)
  const codeViewer = selectedFile ? (
    <>
      <div className="flex items-center gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5">
        {mobileMode && (
          <button onClick={() => { setShowTree(true); onSelectFile(null); }} className="mr-1 flex-shrink-0 rounded p-1 text-gray-400 hover:text-gray-600">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
        <span className="truncate text-xs font-medium text-gray-600">
          {selectedFile.file_path || selectedFile.path}
        </span>
        {(() => {
          const lang = selectedFile.language || detectLanguage(selectedFile.file_path || selectedFile.path);
          if (!lang) return null;
          const colorClass = LANG_COLORS[lang] || 'bg-gray-200 text-gray-600';
          return (
            <span className={`ml-auto flex-shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${colorClass}`}>
              {lang}
            </span>
          );
        })()}
      </div>
      <div className="flex-1 overflow-auto bg-gray-950 p-4">
        <pre className="text-xs leading-relaxed text-gray-100">
          <code>{selectedFile.content || '// No content available'}</code>
        </pre>
      </div>
    </>
  ) : (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <svg className="mb-3 h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
      <p className="text-xs text-gray-400">Select a file to view its contents</p>
    </div>
  );

  const fileTree = fileList.length === 0 ? (
    <div className="px-4 py-8 text-center">
      <svg className="mx-auto mb-2 h-6 w-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
      </svg>
      <p className="text-xs text-gray-400">No files generated yet</p>
    </div>
  ) : (
    <div className="pb-4">
      <FileTreeNode
        node={tree}
        path=""
        selectedPath={selectedFile?.file_path || selectedFile?.path}
        onSelectFile={handleSelectFile}
        collapsedFolders={collapsedFolders}
        onToggleFolder={onToggleFolder}
        isRoot
      />
    </div>
  );

  // Mobile: stacked vertical layout
  if (mobileMode) {
    return (
      <div className="flex h-full flex-col">
        {showTree || !selectedFile ? (
          <div className="flex-1 overflow-y-auto bg-gray-50/50">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Files</span>
              {fileList.length > 0 && (
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">{fileList.length}</span>
              )}
            </div>
            {fileTree}
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">{codeViewer}</div>
        )}
      </div>
    );
  }

  // Desktop: side-by-side
  return (
    <div className="flex h-full">
      <div className="w-56 flex-shrink-0 overflow-y-auto border-r border-gray-200 bg-gray-50/50">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Files</span>
          {fileList.length > 0 && (
            <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-500">{fileList.length}</span>
          )}
        </div>
        {fileTree}
      </div>
      <div className="flex flex-1 flex-col overflow-hidden">{codeViewer}</div>
    </div>
  );
}

// ---------- File Tree Node (recursive) ----------------------------------------

function FileTreeNode({ node, path, selectedPath, onSelectFile, collapsedFolders, onToggleFolder, isRoot }) {
  const folderNames = Object.keys(node.children).sort();
  const fileItems = [...node.files].sort((a, b) =>
    (a.displayName || '').localeCompare(b.displayName || ''),
  );

  return (
    <div className={isRoot ? 'px-2' : 'pl-3'}>
      {/* Folders */}
      {folderNames.map((name) => {
        const folderPath = path ? `${path}/${name}` : name;
        const isCollapsed = collapsedFolders.has(folderPath);
        const child = node.children[name];
        return (
          <div key={folderPath}>
            <button
              onClick={() => onToggleFolder(folderPath)}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs text-gray-600 transition-colors hover:bg-gray-100"
            >
              <svg
                className={`h-3 w-3 flex-shrink-0 text-gray-400 transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <svg className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
              </svg>
              <span className="truncate font-medium">{name}</span>
            </button>
            {!isCollapsed && (
              <FileTreeNode
                node={child}
                path={folderPath}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                collapsedFolders={collapsedFolders}
                onToggleFolder={onToggleFolder}
              />
            )}
          </div>
        );
      })}

      {/* Files */}
      {fileItems.map((file) => {
        const filePath = file.file_path || file.path || '';
        const isSelected = selectedPath === filePath;
        const lang = file.language || detectLanguage(filePath);
        const icon = FILE_ICONS[lang] || '~';
        const iconColor = lang ? (LANG_COLORS[lang] || 'bg-gray-200 text-gray-600') : 'bg-gray-200 text-gray-600';

        return (
          <button
            key={filePath}
            onClick={() => onSelectFile(file)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors ${
              isSelected
                ? 'bg-indigo-50 text-indigo-700 font-medium'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            title={filePath}
          >
            <span className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[8px] font-bold ${iconColor}`}>
              {icon}
            </span>
            <span className="truncate">{file.displayName || filePath.split('/').pop()}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Model Selector Dropdown -------------------------------------------

const MODEL_OPTIONS = [
  { id: 'auto', label: 'Auto', desc: 'Smart routing', icon: '⚡' },
  { id: 'accounts/fireworks/models/qwen3-coder-480b-a35b-instruct', label: 'Qwen3 Coder', desc: 'Best for code', icon: '🔧' },
  { id: 'accounts/fireworks/models/deepseek-v3', label: 'DeepSeek V3', desc: 'Reasoning', icon: '🧠' },
  { id: 'gpt-4o', label: 'GPT-4o', desc: 'Content', icon: '📝' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet', desc: 'Premium code', icon: '💎' },
  { id: 'accounts/fireworks/models/flux-1-dev-fp8', label: 'FLUX.1', desc: 'Image gen', icon: '🎨' },
  { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'Llama 3.3', desc: 'Budget', icon: '🦙' },
];

function ModelSelector({ selectedModel, onSelectModel, isOpen, onToggle, compact }) {
  const selected = MODEL_OPTIONS.find((m) => m.id === selectedModel) || MODEL_OPTIONS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className={`flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 text-xs font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-100 ${compact ? 'px-2 py-1.5' : 'px-2.5 py-2'}`}
        title={`Model: ${selected.label} — ${selected.desc}`}
      >
        <span>{selected.icon}</span>
        <span className={compact ? 'max-w-[60px] truncate' : ''}>{selected.label}</span>
        <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={onToggle} />
          <div className="absolute bottom-full left-0 z-50 mb-1 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Select Model
            </div>
            {MODEL_OPTIONS.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => { onSelectModel(m.id); onToggle(); }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-gray-50 ${
                  selectedModel === m.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700'
                }`}
              >
                <span className="text-base">{m.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{m.label}</div>
                  <div className="text-[10px] text-gray-400">{m.desc}</div>
                </div>
                {selectedModel === m.id && (
                  <svg className="h-4 w-4 flex-shrink-0 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------- Mobile Tab Bar ----------------------------------------------------

function MobileTabBar({ activePanel, onPanelChange, fileCount, secretCount, domainCount }) {
  const tabs = [
    {
      key: 'chat',
      label: 'Chat',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
        </svg>
      ),
    },
    {
      key: 'preview',
      label: 'Preview',
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
    },
    {
      key: 'files',
      label: 'Files',
      badge: fileCount || 0,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
      ),
    },
    {
      key: 'secrets',
      label: 'Secrets',
      badge: secretCount || 0,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
        </svg>
      ),
    },
    {
      key: 'domains',
      label: 'Domains',
      badge: domainCount || 0,
      icon: (
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
        </svg>
      ),
    },
  ];

  return (
    <nav className="flex flex-shrink-0 border-t border-gray-200 bg-white pb-safe">
      {tabs.map(({ key, label, icon, badge }) => (
        <button
          key={key}
          onClick={() => onPanelChange(key)}
          className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
            activePanel === key ? 'text-indigo-600' : 'text-gray-400'
          }`}
        >
          {icon}
          <span className="flex items-center gap-1">
            {label}
            {badge > 0 && (
              <span className="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-gray-100 px-1 text-[9px] font-semibold text-gray-500">
                {badge}
              </span>
            )}
          </span>
        </button>
      ))}
    </nav>
  );
}

// ---------- GitHub Modal ------------------------------------------------------

function GitHubModal({
  onClose,
  onCreateRepo,
  onConnectGitHub,
  repoName,
  onRepoNameChange,
  isPrivate,
  onPrivateChange,
  projectName,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-gray-900">Connect to GitHub</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Create new repo */}
        <form onSubmit={onCreateRepo} className="mb-5">
          <h4 className="mb-3 text-sm font-medium text-gray-700">Create a new repository</h4>
          <div className="space-y-3">
            <input
              type="text"
              placeholder="Repository name"
              value={repoName}
              onChange={(e) => onRepoNameChange(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => onPrivateChange(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              Private repository
            </label>
            <button
              type="submit"
              disabled={!repoName.trim()}
              className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-40"
            >
              Create repo & push code
            </button>
          </div>
        </form>

        <div className="relative mb-5">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
          <div className="relative flex justify-center text-xs"><span className="bg-white px-3 text-gray-400">or</span></div>
        </div>

        {/* Connect existing account */}
        <button
          onClick={onConnectGitHub}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
          </svg>
          Connect GitHub account
        </button>
      </div>
    </div>
  );
}

// ---------- Secrets Tab -------------------------------------------------------

function SecretsTab({ secrets, newSecret, onNewSecretChange, onAddSecret, onDeleteSecret, onDetect, detecting, detectedSecrets, onAddDetected }) {
  return (
    <div className="h-full overflow-y-auto p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900">Project Secrets</h3>
        </div>
        <button
          onClick={onDetect}
          disabled={detecting}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
        >
          {detecting ? (
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
          Detect
        </button>
      </div>

      {/* Info notice */}
      <div className="mb-5 flex items-start gap-2 rounded-lg bg-blue-50 p-3">
        <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-xs text-blue-600">
          Secrets are encrypted at rest and never exposed to AI models. They are only injected into your deployed application at runtime.
        </p>
      </div>

      {/* Detected secrets from file scan */}
      {detectedSecrets && detectedSecrets.length > 0 && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-semibold text-amber-800">
              Found {detectedSecrets.length} secret{detectedSecrets.length !== 1 ? 's' : ''} in code
            </h4>
          </div>
          <ul className="space-y-2">
            {detectedSecrets.map((s) => (
              <li key={s.key} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-amber-100">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800 truncate">{s.key}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      {(s.type || 'env_variable').replace(/_/g, ' ')}
                    </span>
                    {s.files && s.files.length > 0 && (
                      <span className="text-[10px] text-gray-400 truncate" title={s.files.join(', ')}>
                        {s.files[0]}{s.files.length > 1 ? ` +${s.files.length - 1}` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onAddDetected(s)}
                  className="ml-2 shrink-0 rounded-md bg-indigo-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-indigo-700 transition-colors"
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Detection ran but found nothing */}
      {detectedSecrets && detectedSecrets.length === 0 && (
        <div className="mb-5 rounded-lg border border-green-200 bg-green-50 p-3 text-center">
          <p className="text-xs text-green-700">No additional secrets detected in code.</p>
        </div>
      )}

      {/* Existing secrets */}
      {secrets.length === 0 ? (
        <div className="mb-6 rounded-lg border border-dashed border-gray-200 p-6 text-center">
          <svg className="mx-auto mb-2 h-6 w-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <p className="text-xs text-gray-400">No secrets configured yet</p>
        </div>
      ) : (
        <ul className="mb-6 space-y-2">
          {secrets.map((secret) => (
            <li
              key={secret.id}
              className="group flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-100">
                  <svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-800">{secret.key}</p>
                  <span className="mt-0.5 inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
                    {(secret.type || 'api_key').replace(/_/g, ' ')}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onDeleteSecret(secret.id)}
                className="rounded-md p-1.5 text-gray-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                title="Delete secret"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Add secret form */}
      <form onSubmit={onAddSecret} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <h4 className="mb-3 text-xs font-semibold text-gray-700">Add a new secret</h4>
        <div className="space-y-2.5">
          <input
            type="text"
            placeholder="Key name (e.g. OPENAI_API_KEY)"
            value={newSecret.key}
            onChange={(e) => onNewSecretChange({ ...newSecret, key: e.target.value })}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <input
            type="password"
            placeholder="Secret value"
            value={newSecret.value}
            onChange={(e) => onNewSecretChange({ ...newSecret, value: e.target.value })}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          />
          <select
            value={newSecret.type}
            onChange={(e) => onNewSecretChange({ ...newSecret, type: e.target.value })}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
          >
            {SECRET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={!newSecret.key.trim() || !newSecret.value.trim()}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add Secret
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Domains Tab --------------------------------------------------------

function SettingsTab({ project, onUpdateProject, domains, onAddDomain, onRemoveDomain, onRefreshStatus }) {
  const [name, setName] = useState(project?.name || '');
  const [description, setDescription] = useState(project?.description || '');
  const [appType, setAppType] = useState(project?.app_type || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Domain state
  const [newDomain, setNewDomain] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);
  const [domainError, setDomainError] = useState('');
  const [instructions, setInstructions] = useState(null);
  const [checkingId, setCheckingId] = useState(null);

  useEffect(() => {
    setName(project?.name || '');
    setDescription(project?.description || '');
    setAppType(project?.app_type || '');
  }, [project?.id]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    try {
      await onUpdateProject({ name: name.trim(), description: description.trim() });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // handled upstream
    } finally {
      setSaving(false);
    }
  }

  async function handleAddDomain(e) {
    e.preventDefault();
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;
    setAddingDomain(true);
    setDomainError('');
    setInstructions(null);
    try {
      const result = await onAddDomain(domain);
      setNewDomain('');
      if (result?.instructions) setInstructions(result.instructions);
    } catch (err) {
      setDomainError(err.response?.data?.error || err.message || 'Failed to add domain');
    } finally {
      setAddingDomain(false);
    }
  }

  async function handleCheckStatus(domainId) {
    setCheckingId(domainId);
    try { await onRefreshStatus(domainId); } finally { setCheckingId(null); }
  }

  const subdomains = domains.filter((d) => d.domain_type === 'subdomain');
  const customDomains = domains.filter((d) => d.domain_type === 'custom');

  return (
    <div className="h-full overflow-y-auto p-5 space-y-6">
      {/* ---- Project Settings ---- */}
      <form onSubmit={handleSave} className="space-y-4">
        <div className="flex items-center gap-2">
          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900">Project Settings</h3>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My App"
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this project do?"
              rows={3}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100 resize-none"
            />
          </div>
          {appType && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">App Type</label>
              <p className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-500">{appType}</p>
            </div>
          )}
        </div>

        <button
          type="submit"
          disabled={saving || (!name.trim())}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </form>

      <hr className="border-gray-200" />

      {/* ---- Domains ---- */}
      <div>
        <div className="mb-4 flex items-center gap-2">
          <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900">Domains</h3>
        </div>

        {/* Auto-assigned subdomain */}
        {subdomains.length > 0 && (
          <div className="mb-4">
            <h4 className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Auto-assigned</h4>
            {subdomains.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-100">
                    <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-emerald-800 hover:underline">{d.domain}</a>
                    <p className="text-[10px] text-emerald-600">SSL active</p>
                  </div>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">Primary</span>
              </div>
            ))}
          </div>
        )}

        {/* No domains yet */}
        {domains.length === 0 && !project?.deployment_url && (
          <div className="mb-4 rounded-lg border border-dashed border-gray-200 p-6 text-center">
            <svg className="mx-auto mb-2 h-6 w-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3" />
            </svg>
            <p className="text-xs text-gray-400">Deploy your app to get an automatic subdomain</p>
          </div>
        )}

        {/* Custom domains */}
        {customDomains.length > 0 && (
          <div className="mb-4">
            <h4 className="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wide">Custom domains</h4>
            <ul className="space-y-2">
              {customDomains.map((d) => (
                <li key={d.id} className="group flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-3 transition-colors hover:border-gray-300">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-md ${d.ssl_status === 'active' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                      {d.ssl_status === 'active' ? (
                        <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      ) : (
                        <svg className="h-4 w-4 text-amber-600 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2" /></svg>
                      )}
                    </div>
                    <div>
                      <a href={`https://${d.domain}`} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-gray-800 hover:underline">{d.domain}</a>
                      <p className={`text-[10px] ${d.ssl_status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>SSL {d.ssl_status}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleCheckStatus(d.id)} disabled={checkingId === d.id} className="rounded-md p-1.5 text-gray-300 transition-all hover:bg-gray-100 hover:text-gray-600" title="Check SSL status">
                      <svg className={`h-4 w-4 ${checkingId === d.id ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    </button>
                    <button onClick={() => onRemoveDomain(d.id)} className="rounded-md p-1.5 text-gray-300 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100" title="Remove domain">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* CNAME instructions */}
        {instructions && (
          <div className="mb-4 rounded-lg bg-blue-50 p-3">
            <p className="mb-1 text-xs font-medium text-blue-800">{instructions.message}</p>
            <div className="rounded bg-blue-100 px-3 py-2 font-mono text-xs text-blue-700">
              {instructions.record_type} {instructions.record_name} &rarr; {instructions.record_value}
            </div>
            <button onClick={() => setInstructions(null)} className="mt-2 text-[10px] text-blue-600 hover:underline">Dismiss</button>
          </div>
        )}

        {domainError && (
          <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{domainError}</div>
        )}

        {/* Add custom domain form */}
        <form onSubmit={handleAddDomain} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
          <h4 className="mb-3 text-xs font-semibold text-gray-700">Add a custom domain</h4>
          <div className="space-y-2.5">
            <input
              type="text"
              placeholder="app.yourdomain.com"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm placeholder-gray-400 transition-colors focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <p className="text-[10px] text-gray-400">
              After adding, point a CNAME record from your domain to <span className="font-medium">imagia.net</span>
            </p>
            <button
              type="submit"
              disabled={!newDomain.trim() || addingDomain}
              className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-indigo-700 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-40"
            >
              {addingDomain ? 'Adding...' : 'Add Domain'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
