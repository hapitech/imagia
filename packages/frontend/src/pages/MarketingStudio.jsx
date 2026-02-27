import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  getProject,
  getMarketingAssets,
  generateMarketingAssets,
  regenerateMarketingAsset,
  deleteMarketingAsset,
} from '../services/api';

const ASSET_TYPES = [
  { key: 'screenshot', label: 'Screenshots', icon: 'camera' },
  { key: 'video_demo', label: 'Demo Video', icon: 'video' },
  { key: 'landing_page', label: 'Landing Page', icon: 'globe' },
  { key: 'social_post', label: 'Social Posts', icon: 'share' },
  { key: 'ad_copy', label: 'Ad Copy', icon: 'megaphone' },
  { key: 'email_template', label: 'Email Templates', icon: 'mail' },
];

export default function MarketingStudio() {
  const { id: projectId } = useParams();
  const [project, setProject] = useState(null);
  const [assets, setAssets] = useState([]);
  const [grouped, setGrouped] = useState({});
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeType, setActiveType] = useState(null);
  const [previewAsset, setPreviewAsset] = useState(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const [proj, assetData] = await Promise.all([
          getProject(projectId),
          getMarketingAssets(projectId).catch(() => ({ assets: [], grouped: {} })),
        ]);
        if (!cancelled) {
          setProject(proj);
          setAssets(assetData.assets || []);
          setGrouped(assetData.grouped || {});
        }
      } catch (err) {
        console.error('Failed to load marketing data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  async function handleGenerate() {
    if (generating) return;
    try {
      setGenerating(true);
      await generateMarketingAssets(projectId);
      // Poll for results
      setTimeout(refreshAssets, 5000);
      setTimeout(refreshAssets, 15000);
      setTimeout(refreshAssets, 30000);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to start generation');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerate(assetType) {
    try {
      await regenerateMarketingAsset(projectId, assetType);
      setTimeout(refreshAssets, 5000);
      setTimeout(refreshAssets, 15000);
    } catch (err) {
      alert(err.response?.data?.error || 'Regeneration failed');
    }
  }

  async function handleDelete(assetId) {
    try {
      await deleteMarketingAsset(projectId, assetId);
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
      refreshAssets();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }

  async function refreshAssets() {
    try {
      const data = await getMarketingAssets(projectId);
      setAssets(data.assets || []);
      setGrouped(data.grouped || {});
    } catch { /* noop */ }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  const displayAssets = activeType ? (grouped[activeType] || []) : assets;

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Marketing Studio</h1>
            <p className="mt-1 text-sm text-gray-500">
              {project?.name} -- Generate marketing assets for your app
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              to={`/projects/${projectId}`}
              className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Back to Builder
            </Link>
            <button
              onClick={handleGenerate}
              disabled={generating || !project?.deployment_url}
              className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
            >
              {generating ? (
                <>
                  <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Generating...
                </>
              ) : (
                'Generate All Assets'
              )}
            </button>
          </div>
        </div>

        {!project?.deployment_url && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
            Deploy your app first to generate marketing assets.{' '}
            <Link to={`/projects/${projectId}`} className="font-medium underline">Go to Builder</Link>
          </div>
        )}
      </div>

      {/* Asset type filter */}
      <div className="border-b border-gray-200 bg-white px-8 py-3">
        <div className="flex gap-2">
          <button
            onClick={() => setActiveType(null)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
              !activeType ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            All ({assets.length})
          </button>
          {ASSET_TYPES.map(({ key, label }) => {
            const count = (grouped[key] || []).length;
            return (
              <button
                key={key}
                onClick={() => setActiveType(key)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeType === key ? 'bg-indigo-100 text-indigo-700' : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                {label} {count > 0 && `(${count})`}
              </button>
            );
          })}
        </div>
      </div>

      {/* Asset grid */}
      <div className="p-8">
        {displayAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-100">
              <svg className="h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0020.25 4.5H3.75A2.25 2.25 0 001.5 6.75v12A2.25 2.25 0 003.75 21z" />
              </svg>
            </div>
            <h3 className="mb-1 text-sm font-semibold text-gray-700">No marketing assets yet</h3>
            <p className="max-w-xs text-xs text-gray-400">
              Deploy your app and click "Generate All Assets" to create screenshots, videos, landing pages, social posts, and more.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {displayAssets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onPreview={() => setPreviewAsset(asset)}
                onRegenerate={() => handleRegenerate(asset.asset_type)}
                onDelete={() => handleDelete(asset.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Preview modal */}
      {previewAsset && (
        <AssetPreviewModal asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      )}
    </div>
  );
}

// ---------- Asset Card -------------------------------------------------------

function AssetCard({ asset, onPreview, onRegenerate, onDelete }) {
  const metadata = typeof asset.metadata === 'string'
    ? (() => { try { return JSON.parse(asset.metadata); } catch { return {}; } })()
    : asset.metadata || {};

  const typeLabel = asset.asset_type?.replace(/_/g, ' ') || 'Asset';
  const isMedia = asset.asset_type === 'screenshot' || asset.asset_type === 'video_demo';
  const isFailed = asset.status === 'failed';

  return (
    <div className={`group overflow-hidden rounded-xl border transition-shadow hover:shadow-md ${
      isFailed ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'
    }`}>
      {/* Thumbnail */}
      {isMedia && asset.file_url && (
        <div
          className="flex h-40 cursor-pointer items-center justify-center overflow-hidden bg-gray-100"
          onClick={onPreview}
        >
          {asset.asset_type === 'screenshot' ? (
            <img
              src={asset.file_url}
              alt={typeLabel}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-400">
              <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.91 11.672a.375.375 0 010 .656l-5.603 3.113a.375.375 0 01-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112z" />
              </svg>
              <span className="text-xs">Demo Video</span>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {typeLabel}
          </span>
          <span className={`text-[10px] font-medium ${
            asset.status === 'completed' ? 'text-green-500'
              : asset.status === 'generating' ? 'text-amber-500'
                : isFailed ? 'text-red-500'
                  : 'text-gray-400'
          }`}>
            {asset.status}
          </span>
        </div>

        {metadata.platform && (
          <p className="mb-1 text-xs font-medium text-gray-700 capitalize">{metadata.platform}</p>
        )}
        {metadata.email_type && (
          <p className="mb-1 text-xs font-medium text-gray-700 capitalize">{metadata.email_type} email</p>
        )}

        {asset.content && !isMedia && (
          <p className="line-clamp-3 text-xs text-gray-500">
            {asset.content.slice(0, 200)}
            {asset.content.length > 200 && '...'}
          </p>
        )}

        {asset.generation_cost > 0 && (
          <p className="mt-2 text-[10px] text-gray-400">
            Cost: ${parseFloat(asset.generation_cost).toFixed(4)}
          </p>
        )}

        {/* Actions */}
        <div className="mt-3 flex gap-2">
          {!isMedia && asset.content && (
            <button
              onClick={onPreview}
              className="flex-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              Preview
            </button>
          )}
          <button
            onClick={onRegenerate}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            title="Regenerate"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-50 hover:text-red-600"
            title="Delete"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Asset Preview Modal -----------------------------------------------

function AssetPreviewModal({ asset, onClose }) {
  const isHtml = asset.content?.trim()?.startsWith('<') ||
    asset.asset_type === 'landing_page' ||
    asset.asset_type === 'email_template';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-8">
      <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <h3 className="text-sm font-semibold text-gray-900 capitalize">
            {asset.asset_type?.replace(/_/g, ' ')}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {asset.file_url && asset.asset_type === 'screenshot' && (
            <div className="flex items-center justify-center p-4">
              <img src={asset.file_url} alt="Screenshot" className="max-w-full rounded-lg shadow-lg" />
            </div>
          )}

          {asset.file_url && asset.asset_type === 'video_demo' && (
            <div className="flex items-center justify-center p-4">
              <video controls className="max-h-[70vh] max-w-full rounded-lg shadow-lg">
                <source src={asset.file_url} />
              </video>
            </div>
          )}

          {isHtml && asset.content && (
            <iframe
              srcDoc={asset.content}
              title="Preview"
              className="h-full w-full border-0"
              sandbox="allow-scripts"
            />
          )}

          {!isHtml && asset.content && !asset.file_url && (
            <div className="p-6">
              <pre className="whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
                {asset.content}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
