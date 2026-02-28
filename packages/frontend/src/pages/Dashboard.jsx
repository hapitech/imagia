import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getProjects,
  createProject,
  githubListRepos,
  githubImportRepo,
} from '../services/api';

const STATUS_COLORS = {
  draft: 'bg-gray-200 text-gray-700',
  building: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-blue-100 text-blue-800',
  deployed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);

  // GitHub import state
  const [ghStep, setGhStep] = useState('loading'); // loading | connect | repos | importing
  const [ghRepos, setGhRepos] = useState([]);
  const [ghPage, setGhPage] = useState(1);
  const [ghSearch, setGhSearch] = useState('');
  const [ghLoading, setGhLoading] = useState(false);
  const [ghError, setGhError] = useState(null);
  const [ghSelected, setGhSelected] = useState(null);
  const [ghCustomName, setGhCustomName] = useState('');
  const [ghImporting, setGhImporting] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      setLoading(true);
      const data = await getProjects();
      setProjects(Array.isArray(data) ? data : data.projects || []);
    } catch (err) {
      console.error('Failed to load projects:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!newProject.name.trim()) return;

    try {
      setCreating(true);
      setError(null);
      const data = await createProject(newProject);
      const project = data.project || data;
      setShowCreateModal(false);
      setNewProject({ name: '', description: '' });
      navigate(`/project/${project.id}`);
    } catch (err) {
      console.error('Failed to create project:', err);
      setError(err.response?.data?.error || 'Failed to create project');
    } finally {
      setCreating(false);
    }
  }

  // --- GitHub import flow ---

  async function openImportModal() {
    setShowImportModal(true);
    setGhStep('loading');
    setGhError(null);
    setGhSelected(null);
    setGhCustomName('');
    setGhSearch('');
    setGhPage(1);

    // Try loading repos to see if GitHub is connected
    try {
      setGhLoading(true);
      const data = await githubListRepos({ page: 1, per_page: 30 });
      setGhRepos(data.repos || []);
      setGhStep('repos');
    } catch (err) {
      if (err.response?.status === 403) {
        setGhStep('connect');
      } else {
        setGhError(err.response?.data?.error || 'Failed to load repos');
        setGhStep('connect');
      }
    } finally {
      setGhLoading(false);
    }
  }

  async function loadMoreRepos() {
    try {
      setGhLoading(true);
      const nextPage = ghPage + 1;
      const data = await githubListRepos({ page: nextPage, per_page: 30 });
      const newRepos = data.repos || [];
      if (newRepos.length > 0) {
        setGhRepos((prev) => [...prev, ...newRepos]);
        setGhPage(nextPage);
      }
    } catch (err) {
      setGhError('Failed to load more repos');
    } finally {
      setGhLoading(false);
    }
  }

  async function handleGhImport() {
    if (!ghSelected) return;
    try {
      setGhImporting(true);
      setGhError(null);
      const data = await githubImportRepo({
        repo_full_name: ghSelected.full_name,
        project_name: ghCustomName.trim() || undefined,
      });
      const project = data.project;
      setShowImportModal(false);
      navigate(`/project/${project.id}`);
    } catch (err) {
      setGhError(err.response?.data?.error || 'Import failed');
      setGhImporting(false);
    }
  }

  const filteredRepos = ghSearch
    ? ghRepos.filter(
        (r) =>
          r.full_name.toLowerCase().includes(ghSearch.toLowerCase()) ||
          (r.description || '').toLowerCase().includes(ghSearch.toLowerCase())
      )
    : ghRepos;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="px-4 py-4 md:px-0 md:py-0">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Your Apps</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={openImportModal}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors sm:flex-initial"
          >
            <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span className="whitespace-nowrap">Import from GitHub</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary/90 transition-colors sm:flex-initial"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            New App
          </button>
        </div>
      </div>

      {/* Project grid or empty state */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-300 bg-white py-20">
          <svg className="mb-4 h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
            />
          </svg>
          <p className="mb-2 text-lg font-medium text-gray-700">No apps yet</p>
          <p className="mb-6 text-sm text-gray-500">Create a new app or import one from GitHub</p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
            >
              Create New App
            </button>
            <button
              onClick={openImportModal}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Import from GitHub
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <button
              key={project.id}
              onClick={() => navigate(`/project/${project.id}`)}
              className="group flex flex-col rounded-xl border border-gray-200 bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-gray-900 group-hover:text-primary transition-colors">
                  {project.name}
                </h3>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    STATUS_COLORS[project.status] || STATUS_COLORS.draft
                  }`}
                >
                  {project.status || 'draft'}
                </span>
              </div>
              {project.description && (
                <p className="mb-3 line-clamp-2 text-sm text-gray-500">
                  {project.description}
                </p>
              )}
              <div className="mt-auto flex items-center justify-between pt-3 border-t border-gray-100">
                <span className="text-xs text-gray-400">
                  {project.created_at
                    ? new Date(project.created_at).toLocaleDateString()
                    : ''}
                </span>
                <div className="flex items-center gap-2">
                  {project.github_repo_url && (
                    <svg className="h-3.5 w-3.5 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                    </svg>
                  )}
                  {project.deployment_url && (
                    <a
                      href={project.deployment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      View live
                    </a>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create New App Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-md rounded-t-xl bg-white p-6 shadow-2xl sm:rounded-xl">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Create New App</h2>
            {error && (
              <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
            <form onSubmit={handleCreate}>
              <div className="mb-4">
                <label htmlFor="project-name" className="mb-1 block text-sm font-medium text-gray-700">
                  App Name
                </label>
                <input
                  id="project-name"
                  type="text"
                  required
                  value={newProject.name}
                  onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="My awesome app"
                  autoFocus
                />
              </div>
              <div className="mb-6">
                <label htmlFor="project-desc" className="mb-1 block text-sm font-medium text-gray-700">
                  Description
                </label>
                <textarea
                  id="project-desc"
                  value={newProject.description}
                  onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Describe what your app will do..."
                  rows={3}
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewProject({ name: '', description: '' });
                    setError(null);
                  }}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {creating ? 'Creating...' : 'Create App'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import from GitHub Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-white shadow-2xl sm:rounded-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div className="flex items-center gap-3">
                <svg className="h-5 w-5 text-gray-700" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                </svg>
                <h2 className="text-lg font-semibold text-gray-900">Import from GitHub</h2>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-6 py-5">
              {ghError && (
                <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{ghError}</div>
              )}

              {/* Step: Loading */}
              {ghStep === 'loading' && (
                <div className="flex h-40 items-center justify-center">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                </div>
              )}

              {/* Step: Connect GitHub */}
              {ghStep === 'connect' && (
                <div className="flex flex-col items-center py-8">
                  <svg className="mb-4 h-12 w-12 text-gray-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  <p className="mb-2 text-base font-medium text-gray-700">Connect your GitHub account</p>
                  <p className="mb-4 text-sm text-gray-500 text-center">
                    To import repositories, connect your GitHub account in Settings.
                  </p>
                  <button
                    onClick={() => {
                      setShowImportModal(false);
                      navigate('/settings');
                    }}
                    className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    Go to Settings
                  </button>
                </div>
              )}

              {/* Step: Browse Repos */}
              {ghStep === 'repos' && (
                <div>
                  {/* Search */}
                  <div className="mb-4">
                    <input
                      type="text"
                      value={ghSearch}
                      onChange={(e) => setGhSearch(e.target.value)}
                      placeholder="Search repositories..."
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  {/* Repo list */}
                  <div className="max-h-80 space-y-1 overflow-y-auto">
                    {filteredRepos.length === 0 ? (
                      <p className="py-8 text-center text-sm text-gray-500">
                        {ghSearch ? 'No repos match your search' : 'No repositories found'}
                      </p>
                    ) : (
                      filteredRepos.map((repo) => (
                        <button
                          key={repo.id}
                          onClick={() => {
                            setGhSelected(repo);
                            setGhCustomName(repo.name);
                          }}
                          className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                            ghSelected?.id === repo.id
                              ? 'bg-primary/10 ring-1 ring-primary'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900 truncate">
                                {repo.full_name}
                              </span>
                              {repo.private && (
                                <span className="inline-flex shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600">
                                  Private
                                </span>
                              )}
                            </div>
                            {repo.description && (
                              <p className="mt-0.5 text-xs text-gray-500 truncate">{repo.description}</p>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {repo.language && (
                              <span className="text-xs text-gray-400">{repo.language}</span>
                            )}
                            {ghSelected?.id === repo.id && (
                              <svg className="h-4 w-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>

                  {/* Load more */}
                  {!ghSearch && ghRepos.length >= ghPage * 30 && (
                    <div className="mt-3 text-center">
                      <button
                        onClick={loadMoreRepos}
                        disabled={ghLoading}
                        className="text-sm font-medium text-primary hover:text-primary/80 disabled:opacity-50"
                      >
                        {ghLoading ? 'Loading...' : 'Load more repos'}
                      </button>
                    </div>
                  )}

                  {/* Selected repo - custom name */}
                  {ghSelected && (
                    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <label className="mb-1 block text-xs font-medium text-gray-600">
                        Project name (optional)
                      </label>
                      <input
                        type="text"
                        value={ghCustomName}
                        onChange={(e) => setGhCustomName(e.target.value)}
                        placeholder={ghSelected.name}
                        className="w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Step: Importing */}
              {ghStep === 'importing' && (
                <div className="flex flex-col items-center py-12">
                  <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <p className="text-sm font-medium text-gray-700">Importing repository...</p>
                  <p className="mt-1 text-xs text-gray-500">Downloading files from GitHub</p>
                </div>
              )}
            </div>

            {/* Footer */}
            {ghStep === 'repos' && (
              <div className="flex justify-end gap-3 border-t border-gray-200 px-6 py-4">
                <button
                  onClick={() => setShowImportModal(false)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    setGhStep('importing');
                    handleGhImport();
                  }}
                  disabled={!ghSelected || ghImporting}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {ghImporting ? 'Importing...' : 'Import Repository'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
