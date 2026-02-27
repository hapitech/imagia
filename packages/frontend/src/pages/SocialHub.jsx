import { useState, useEffect, useCallback } from 'react';
import {
  getSocialAccounts,
  getSocialOAuthUrl,
  disconnectSocialAccount,
  createSocialPost,
  getSocialPosts,
  deleteSocialPost,
  publishSocialPost,
  refreshEngagement,
  getProjects,
} from '../services/api';

const PLATFORMS = [
  { key: 'twitter', label: 'Twitter / X', color: 'bg-black', icon: 'X', maxChars: 280 },
  { key: 'linkedin', label: 'LinkedIn', color: 'bg-blue-700', icon: 'in', maxChars: 3000 },
  { key: 'instagram', label: 'Instagram', color: 'bg-gradient-to-r from-purple-500 to-pink-500', icon: 'IG', maxChars: 2200 },
  { key: 'facebook', label: 'Facebook', color: 'bg-blue-600', icon: 'f', maxChars: 63206 },
];

const POST_STATUS_COLORS = {
  draft: 'bg-gray-100 text-gray-600',
  scheduled: 'bg-blue-50 text-blue-600',
  posting: 'bg-amber-50 text-amber-600',
  posted: 'bg-green-50 text-green-600',
  failed: 'bg-red-50 text-red-600',
};

export default function SocialHub() {
  const [accounts, setAccounts] = useState([]);
  const [posts, setPosts] = useState([]);
  const [pagination, setPagination] = useState({});
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('compose'); // compose | queue | accounts
  const [connectingPlatform, setConnectingPlatform] = useState(null);

  // Compose state
  const [composeContent, setComposeContent] = useState('');
  const [composeAccountId, setComposeAccountId] = useState('');
  const [composeProjectId, setComposeProjectId] = useState('');
  const [composeScheduleAt, setComposeScheduleAt] = useState('');
  const [composing, setComposing] = useState(false);

  // Post list state
  const [postFilter, setPostFilter] = useState('');
  const [postPage, setPostPage] = useState(1);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [accts, postData, projData] = await Promise.all([
        getSocialAccounts().catch(() => ({ accounts: [] })),
        getSocialPosts({ page: 1, limit: 20 }).catch(() => ({ posts: [], pagination: {} })),
        getProjects().catch(() => ({ projects: [] })),
      ]);
      setAccounts(accts.accounts || []);
      setPosts(postData.posts || []);
      setPagination(postData.pagination || {});
      setProjects(Array.isArray(projData) ? projData : projData.projects || []);
    } catch (err) {
      console.error('Failed to load social data:', err);
    } finally {
      setLoading(false);
    }
  }

  const loadPosts = useCallback(async () => {
    try {
      const params = { page: postPage, limit: 20 };
      if (postFilter) params.status = postFilter;
      const data = await getSocialPosts(params);
      setPosts(data.posts || []);
      setPagination(data.pagination || {});
    } catch { /* noop */ }
  }, [postPage, postFilter]);

  useEffect(() => {
    if (!loading) loadPosts();
  }, [loadPosts, loading]);

  // OAuth connect
  async function handleConnect(platform) {
    try {
      setConnectingPlatform(platform);
      const { url } = await getSocialOAuthUrl(platform);
      // Open OAuth popup
      const popup = window.open(url, `${platform}_oauth`, 'width=600,height=700');
      // Poll for popup close (OAuth callback redirects back)
      const interval = setInterval(() => {
        if (popup?.closed) {
          clearInterval(interval);
          setConnectingPlatform(null);
          loadData(); // Refresh accounts
        }
      }, 500);
    } catch (err) {
      alert(err.response?.data?.error || `Failed to connect ${platform}`);
      setConnectingPlatform(null);
    }
  }

  async function handleDisconnect(accountId) {
    if (!confirm('Disconnect this account? Scheduled posts will be moved to draft.')) return;
    try {
      await disconnectSocialAccount(accountId);
      setAccounts((prev) => prev.filter((a) => a.id !== accountId));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to disconnect');
    }
  }

  // Compose & schedule
  async function handleSubmitPost(publishNow = false) {
    if (!composeContent.trim() || !composeAccountId) return;
    setComposing(true);
    try {
      const data = {
        social_account_id: composeAccountId,
        content: composeContent,
        media_urls: [],
      };
      if (composeProjectId) data.project_id = composeProjectId;
      if (!publishNow && composeScheduleAt) data.scheduled_at = new Date(composeScheduleAt).toISOString();

      const { post } = await createSocialPost(data);

      if (publishNow) {
        await publishSocialPost(post.id);
      }

      setComposeContent('');
      setComposeScheduleAt('');
      loadPosts();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create post');
    } finally {
      setComposing(false);
    }
  }

  async function handleDeletePost(postId) {
    if (!confirm('Delete this post?')) return;
    try {
      await deleteSocialPost(postId);
      setPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  }

  async function handlePublishPost(postId) {
    try {
      await publishSocialPost(postId);
      loadPosts();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to publish');
    }
  }

  async function handleRefreshEngagement(postId) {
    try {
      await refreshEngagement(postId);
      loadPosts();
    } catch { /* noop */ }
  }

  // Selected account info
  const selectedAccount = accounts.find((a) => a.id === composeAccountId);
  const selectedPlatform = PLATFORMS.find((p) => p.key === selectedAccount?.platform);
  const charLimit = selectedPlatform?.maxChars || 280;
  const charRemaining = charLimit - composeContent.length;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-8 py-6">
        <h1 className="text-xl font-bold text-gray-900">Social Hub</h1>
        <p className="mt-1 text-sm text-gray-500">
          Connect social accounts, compose posts, and track engagement
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 bg-white px-8">
        <div className="flex gap-4">
          {[
            { key: 'compose', label: 'Compose' },
            { key: 'queue', label: `Post Queue (${pagination.total || 0})` },
            { key: 'accounts', label: `Accounts (${accounts.length})` },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                activeTab === key
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-8">
        {activeTab === 'compose' && (
          <ComposeTab
            accounts={accounts}
            projects={projects}
            composeContent={composeContent}
            setComposeContent={setComposeContent}
            composeAccountId={composeAccountId}
            setComposeAccountId={setComposeAccountId}
            composeProjectId={composeProjectId}
            setComposeProjectId={setComposeProjectId}
            composeScheduleAt={composeScheduleAt}
            setComposeScheduleAt={setComposeScheduleAt}
            composing={composing}
            charRemaining={charRemaining}
            charLimit={charLimit}
            selectedPlatform={selectedPlatform}
            onSubmit={handleSubmitPost}
            onConnect={handleConnect}
            connectingPlatform={connectingPlatform}
          />
        )}

        {activeTab === 'queue' && (
          <PostQueueTab
            posts={posts}
            pagination={pagination}
            postFilter={postFilter}
            setPostFilter={setPostFilter}
            postPage={postPage}
            setPostPage={setPostPage}
            onDelete={handleDeletePost}
            onPublish={handlePublishPost}
            onRefreshEngagement={handleRefreshEngagement}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsTab
            accounts={accounts}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            connectingPlatform={connectingPlatform}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Compose Tab --------------------------------------------------------

function ComposeTab({
  accounts, projects,
  composeContent, setComposeContent,
  composeAccountId, setComposeAccountId,
  composeProjectId, setComposeProjectId,
  composeScheduleAt, setComposeScheduleAt,
  composing, charRemaining, charLimit, selectedPlatform,
  onSubmit, onConnect, connectingPlatform,
}) {
  if (accounts.length === 0) {
    return (
      <div className="mx-auto max-w-lg">
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50">
            <svg className="h-7 w-7 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
            </svg>
          </div>
          <h3 className="mb-2 text-sm font-semibold text-gray-700">No accounts connected</h3>
          <p className="mb-6 text-xs text-gray-400">
            Connect a social media account to start composing and scheduling posts.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {PLATFORMS.map((p) => (
              <button
                key={p.key}
                onClick={() => onConnect(p.key)}
                disabled={connectingPlatform === p.key}
                className={`flex items-center gap-2 rounded-lg ${p.color} px-4 py-2 text-xs font-medium text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50`}
              >
                <span className="text-[10px] font-bold">{p.icon}</span>
                {connectingPlatform === p.key ? 'Connecting...' : `Connect ${p.label}`}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="mb-4 text-sm font-semibold text-gray-700">Compose Post</h3>

        {/* Account selector */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-500">Post to</label>
          <select
            value={composeAccountId}
            onChange={(e) => setComposeAccountId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-indigo-300 focus:outline-none"
          >
            <option value="">Select account...</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.platform} - {a.platform_username || a.account_metadata?.handle || a.account_metadata?.name || 'Account'}
              </option>
            ))}
          </select>
        </div>

        {/* Content */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-500">Content</label>
          <textarea
            value={composeContent}
            onChange={(e) => setComposeContent(e.target.value)}
            placeholder={selectedPlatform ? `Write your ${selectedPlatform.label} post...` : 'Select an account first...'}
            rows={5}
            className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 placeholder-gray-400 focus:border-indigo-300 focus:outline-none"
          />
          {composeAccountId && (
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[10px] text-gray-400">
                {selectedPlatform?.label} - max {charLimit.toLocaleString()} chars
              </span>
              <span className={`text-[10px] font-medium ${charRemaining < 0 ? 'text-red-500' : charRemaining < 20 ? 'text-amber-500' : 'text-gray-400'}`}>
                {charRemaining} remaining
              </span>
            </div>
          )}
        </div>

        {/* Project (optional) */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-500">Project (optional)</label>
          <select
            value={composeProjectId}
            onChange={(e) => setComposeProjectId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-indigo-300 focus:outline-none"
          >
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* Schedule */}
        <div className="mb-6">
          <label className="mb-1 block text-xs font-medium text-gray-500">Schedule (optional)</label>
          <input
            type="datetime-local"
            value={composeScheduleAt}
            onChange={(e) => setComposeScheduleAt(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 focus:border-indigo-300 focus:outline-none"
          />
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={() => onSubmit(true)}
            disabled={composing || !composeContent.trim() || !composeAccountId || charRemaining < 0}
            className="flex-1 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 disabled:opacity-40"
          >
            {composing ? 'Publishing...' : 'Publish Now'}
          </button>
          <button
            onClick={() => onSubmit(false)}
            disabled={composing || !composeContent.trim() || !composeAccountId || charRemaining < 0}
            className="rounded-lg border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            {composeScheduleAt ? 'Schedule' : 'Save Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Post Queue Tab -----------------------------------------------------

function PostQueueTab({
  posts, pagination, postFilter, setPostFilter, postPage, setPostPage,
  onDelete, onPublish, onRefreshEngagement,
}) {
  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex items-center gap-3">
        <select
          value={postFilter}
          onChange={(e) => { setPostFilter(e.target.value); setPostPage(1); }}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 focus:border-indigo-300 focus:outline-none"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="scheduled">Scheduled</option>
          <option value="posting">Posting</option>
          <option value="posted">Posted</option>
          <option value="failed">Failed</option>
        </select>
        <span className="text-xs text-gray-400">{pagination.total || 0} posts</span>
      </div>

      {posts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg className="mb-3 h-10 w-10 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-600">No posts yet</h3>
          <p className="mt-1 text-xs text-gray-400">Compose a post to get started</p>
        </div>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              onDelete={() => onDelete(post.id)}
              onPublish={() => onPublish(post.id)}
              onRefreshEngagement={() => onRefreshEngagement(post.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.total_pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            Page {pagination.page} of {pagination.total_pages}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setPostPage((p) => Math.max(1, p - 1))}
              disabled={postPage <= 1}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPostPage((p) => Math.min(pagination.total_pages, p + 1))}
              disabled={postPage >= pagination.total_pages}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Post Card ----------------------------------------------------------

function PostCard({ post, onDelete, onPublish, onRefreshEngagement }) {
  const engagement = typeof post.engagement === 'string'
    ? (() => { try { return JSON.parse(post.engagement); } catch { return {}; } })()
    : post.engagement || {};

  const platformInfo = PLATFORMS.find((p) => p.key === post.platform);
  const scheduledDate = post.scheduled_at
    ? new Date(post.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;
  const postedDate = post.posted_at
    ? new Date(post.posted_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {/* Platform badge */}
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold text-white ${platformInfo?.color || 'bg-gray-400'}`}>
            {platformInfo?.icon || '?'}
          </span>
          <div>
            <span className="text-xs font-medium text-gray-700">
              {post.platform_username || platformInfo?.label || post.platform}
            </span>
            <span className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${POST_STATUS_COLORS[post.status] || 'bg-gray-100 text-gray-500'}`}>
              {post.status}
            </span>
          </div>
        </div>

        <div className="flex gap-1">
          {(post.status === 'draft' || post.status === 'scheduled' || post.status === 'failed') && (
            <button
              onClick={onPublish}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50"
              title="Publish now"
            >
              Publish
            </button>
          )}
          {post.status === 'posted' && (
            <button
              onClick={onRefreshEngagement}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-50"
              title="Refresh engagement"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
              </svg>
            </button>
          )}
          {post.status !== 'posting' && (
            <button
              onClick={onDelete}
              className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-50 hover:text-red-600"
              title="Delete"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Content preview */}
      <p className="mt-3 text-sm text-gray-600 line-clamp-3">
        {post.content}
      </p>

      {/* Timing info */}
      <div className="mt-2 flex gap-4 text-[10px] text-gray-400">
        {scheduledDate && <span>Scheduled: {scheduledDate}</span>}
        {postedDate && <span>Posted: {postedDate}</span>}
        {!scheduledDate && !postedDate && (
          <span>Created: {new Date(post.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric' })}</span>
        )}
      </div>

      {/* Engagement stats */}
      {post.status === 'posted' && Object.keys(engagement).length > 0 && (
        <div className="mt-3 flex gap-4 rounded-lg bg-gray-50 px-3 py-2">
          {engagement.likes !== undefined && (
            <EngagementStat label="Likes" value={engagement.likes} />
          )}
          {engagement.shares !== undefined && (
            <EngagementStat label="Shares" value={engagement.shares} />
          )}
          {engagement.comments !== undefined && (
            <EngagementStat label="Comments" value={engagement.comments} />
          )}
          {engagement.impressions > 0 && (
            <EngagementStat label="Impressions" value={engagement.impressions} />
          )}
        </div>
      )}

      {/* Error message */}
      {post.status === 'failed' && post.error_message && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
          {post.error_message}
        </div>
      )}
    </div>
  );
}

function EngagementStat({ label, value }) {
  return (
    <div className="text-center">
      <p className="text-sm font-semibold text-gray-700">{formatNumber(value)}</p>
      <p className="text-[10px] text-gray-400">{label}</p>
    </div>
  );
}

// ---------- Accounts Tab -------------------------------------------------------

function AccountsTab({ accounts, onConnect, onDisconnect, connectingPlatform }) {
  return (
    <div>
      <h3 className="mb-4 text-sm font-semibold text-gray-700">Connected Accounts</h3>

      {/* Connected accounts */}
      {accounts.length > 0 && (
        <div className="mb-6 space-y-3">
          {accounts.map((account) => {
            const platformInfo = PLATFORMS.find((p) => p.key === account.platform);
            const metadata = account.account_metadata || {};

            return (
              <div key={account.id} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold text-white ${platformInfo?.color || 'bg-gray-400'}`}>
                    {platformInfo?.icon || '?'}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-gray-700">
                      {metadata.handle || metadata.name || account.platform_username || platformInfo?.label}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-gray-400">
                      <span className="capitalize">{account.platform}</span>
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                        account.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
                      }`}>
                        {account.status}
                      </span>
                      {metadata.followers > 0 && <span>{formatNumber(metadata.followers)} followers</span>}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => onDisconnect(account.id)}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-50 hover:text-red-600"
                >
                  Disconnect
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add new connection */}
      <h3 className="mb-3 text-sm font-semibold text-gray-700">Connect New Account</h3>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {PLATFORMS.map((p) => {
          const connected = accounts.some((a) => a.platform === p.key);

          return (
            <button
              key={p.key}
              onClick={() => onConnect(p.key)}
              disabled={connectingPlatform === p.key}
              className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-5 transition-shadow hover:shadow-md disabled:opacity-50"
            >
              <span className={`flex h-12 w-12 items-center justify-center rounded-xl text-sm font-bold text-white ${p.color}`}>
                {p.icon}
              </span>
              <span className="text-xs font-medium text-gray-700">{p.label}</span>
              {connected && (
                <span className="text-[10px] text-green-500">Connected</span>
              )}
              {connectingPlatform === p.key && (
                <span className="text-[10px] text-amber-500">Connecting...</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Helpers ------------------------------------------------------------

function formatNumber(val) {
  const n = parseInt(val) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}
