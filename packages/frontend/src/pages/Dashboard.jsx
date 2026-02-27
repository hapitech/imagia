import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getProjects, createProject } from '../services/api';

const STATUS_COLORS = {
  draft: 'bg-gray-200 text-gray-700',
  building: 'bg-yellow-100 text-yellow-800',
  deployed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newProject, setNewProject] = useState({ name: '', description: '' });
  const [creating, setCreating] = useState(false);

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
      const project = await createProject(newProject);
      setShowModal(false);
      setNewProject({ name: '', description: '' });
      navigate(`/project/${project.id}`);
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Your Apps</h1>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-primary/90 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New App
        </button>
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
          <p className="mb-6 text-sm text-gray-500">Create your first one!</p>
          <button
            onClick={() => setShowModal(true)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
          >
            Create Your First App
          </button>
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
                  {project.createdAt
                    ? new Date(project.createdAt).toLocaleDateString()
                    : ''}
                </span>
                {project.deploymentUrl && (
                  <a
                    href={project.deploymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    View live
                  </a>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* New App Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Create New App</h2>
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
                    setShowModal(false);
                    setNewProject({ name: '', description: '' });
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
    </div>
  );
}
