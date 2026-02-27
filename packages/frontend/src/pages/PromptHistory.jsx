import { useState, useEffect, useCallback } from 'react';
import { getPrompts, getPromptStats, getPromptFilters, getPromptDetail } from '../services/api';

export default function PromptHistory() {
  const [prompts, setPrompts] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, total_pages: 0 });
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedDetail, setExpandedDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Filter state
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [taskType, setTaskType] = useState('');
  const [status, setStatus] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);

  // Load filters + stats once
  useEffect(() => {
    Promise.all([
      getPromptStats().catch(() => null),
      getPromptFilters().catch(() => null),
    ]).then(([s, f]) => {
      setStats(s);
      setFilters(f);
    });
  }, []);

  // Load prompts whenever filters change
  const loadPrompts = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 20, sort_by: sortBy, sort_order: sortOrder };
      if (search) params.search = search;
      if (provider) params.provider = provider;
      if (model) params.model = model;
      if (taskType) params.task_type = taskType;
      if (status) params.status = status;

      const data = await getPrompts(params);
      setPrompts(data.prompts || []);
      setPagination(data.pagination || {});
    } catch (err) {
      console.error('Failed to load prompts:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, provider, model, taskType, status, sortBy, sortOrder]);

  useEffect(() => {
    loadPrompts();
  }, [loadPrompts]);

  // Debounced search
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Expand / collapse detail
  async function toggleExpand(id) {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    setDetailLoading(true);
    try {
      const data = await getPromptDetail(id);
      setExpandedDetail(data.prompt);
    } catch {
      setExpandedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  function handleSort(col) {
    if (sortBy === col) {
      setSortOrder((o) => (o === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(col);
      setSortOrder('desc');
    }
    setPage(1);
  }

  function handleFilterChange(setter) {
    return (e) => {
      setter(e.target.value);
      setPage(1);
    };
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-8 py-6">
        <h1 className="text-xl font-bold text-gray-900">Prompt History</h1>
        <p className="mt-1 text-sm text-gray-500">
          Review all LLM calls, token usage, costs, and latency
        </p>
      </div>

      {/* Stats bar */}
      {stats && (
        <div className="border-b border-gray-200 bg-gray-50 px-8 py-3">
          <div className="flex gap-6 text-xs text-gray-500">
            <span>
              <strong className="text-gray-700">{formatNumber(stats.total_requests)}</strong> total requests
            </span>
            <span>
              <strong className="text-gray-700">{formatTokens(stats.total_tokens)}</strong> tokens
            </span>
            <span>
              <strong className="text-gray-700">${formatCost(stats.total_cost)}</strong> total cost
            </span>
            {stats.by_provider?.map((p) => (
              <span key={p.provider} className="capitalize">
                {p.provider}: {formatNumber(p.requests)} reqs
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="border-b border-gray-200 bg-white px-8 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search prompts & responses..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-64 rounded-lg border border-gray-200 py-1.5 pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-300"
            />
          </div>

          {/* Provider */}
          <select
            value={provider}
            onChange={handleFilterChange(setProvider)}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 focus:border-indigo-300 focus:outline-none"
          >
            <option value="">All Providers</option>
            {filters?.providers?.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>

          {/* Model */}
          <select
            value={model}
            onChange={handleFilterChange(setModel)}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 focus:border-indigo-300 focus:outline-none"
          >
            <option value="">All Models</option>
            {filters?.models?.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          {/* Task type */}
          <select
            value={taskType}
            onChange={handleFilterChange(setTaskType)}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 focus:border-indigo-300 focus:outline-none"
          >
            <option value="">All Tasks</option>
            {filters?.task_types?.map((t) => (
              <option key={t} value={t}>{t?.replace(/_/g, ' ')}</option>
            ))}
          </select>

          {/* Status */}
          <select
            value={status}
            onChange={handleFilterChange(setStatus)}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-600 focus:border-indigo-300 focus:outline-none"
          >
            <option value="">All Statuses</option>
            {filters?.statuses?.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Clear filters */}
          {(search || provider || model || taskType || status) && (
            <button
              onClick={() => {
                setSearchInput('');
                setSearch('');
                setProvider('');
                setModel('');
                setTaskType('');
                setStatus('');
                setPage(1);
              }}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
            >
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="px-8 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
          </div>
        ) : prompts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <svg className="mb-3 h-10 w-10 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-600">No prompts found</h3>
            <p className="mt-1 text-xs text-gray-400">
              {search ? 'Try adjusting your search or filters' : 'Prompts will appear here after LLM calls are made'}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-gray-200">
            <table className="w-full text-left">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-8 px-3 py-2.5" />
                  <SortHeader col="created_at" label="Time" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} />
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-500">Provider / Model</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-500">Task</th>
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-500">Prompt</th>
                  <SortHeader col="total_tokens" label="Tokens" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} />
                  <SortHeader col="total_cost" label="Cost" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} />
                  <SortHeader col="latency_ms" label="Latency" sortBy={sortBy} sortOrder={sortOrder} onClick={handleSort} />
                  <th className="px-3 py-2.5 text-xs font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {prompts.map((p) => (
                  <PromptRow
                    key={p.id}
                    prompt={p}
                    expanded={expandedId === p.id}
                    detail={expandedId === p.id ? expandedDetail : null}
                    detailLoading={expandedId === p.id && detailLoading}
                    onToggle={() => toggleExpand(p.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.total_pages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Showing {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                Previous
              </button>
              {generatePageNumbers(pagination.page, pagination.total_pages).map((p) =>
                p === '...' ? (
                  <span key={`dots-${Math.random()}`} className="px-2 py-1.5 text-xs text-gray-400">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      p === page
                        ? 'bg-indigo-50 text-indigo-600'
                        : 'border border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
              <button
                onClick={() => setPage((p) => Math.min(pagination.total_pages, p + 1))}
                disabled={page >= pagination.total_pages}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Prompt Row ---------------------------------------------------------

function PromptRow({ prompt: p, expanded, detail, detailLoading, onToggle }) {
  const time = new Date(p.created_at).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  return (
    <>
      <tr className="cursor-pointer hover:bg-gray-50" onClick={onToggle}>
        <td className="px-3 py-2.5">
          <svg
            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-gray-500">{time}</td>
        <td className="px-3 py-2.5">
          <span className="text-[10px] text-gray-400">{p.provider}</span>
          <span className="mx-0.5 text-gray-300">/</span>
          <span className="text-xs font-medium text-gray-700">{p.model}</span>
        </td>
        <td className="px-3 py-2.5">
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500">
            {p.task_type?.replace(/_/g, ' ')}
          </span>
        </td>
        <td className="max-w-[200px] truncate px-3 py-2.5 text-xs text-gray-500">
          {p.prompt_preview}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-gray-600">
          {formatTokens(p.total_tokens)}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium text-gray-900">
          ${formatCost(p.total_cost)}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs text-gray-600">
          {p.latency_ms}ms
        </td>
        <td className="px-3 py-2.5">
          <StatusBadge status={p.status} cacheHit={p.cache_hit} />
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td colSpan={9} className="bg-gray-50 px-6 py-4">
            {detailLoading ? (
              <div className="flex justify-center py-4">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-500 border-t-transparent" />
              </div>
            ) : detail ? (
              <PromptDetail prompt={detail} />
            ) : (
              <p className="text-xs text-gray-400">Failed to load details</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- Prompt Detail (expanded) -------------------------------------------

function PromptDetail({ prompt: p }) {
  return (
    <div className="space-y-4">
      {/* Metrics row */}
      <div className="flex flex-wrap gap-4 text-xs">
        <MetricPill label="Input Tokens" value={formatNumber(p.input_tokens)} />
        <MetricPill label="Output Tokens" value={formatNumber(p.output_tokens)} />
        <MetricPill label="Input Cost" value={`$${formatCost(p.input_cost)}`} />
        <MetricPill label="Output Cost" value={`$${formatCost(p.output_cost)}`} />
        <MetricPill label="Total Cost" value={`$${formatCost(p.total_cost)}`} />
        <MetricPill label="Latency" value={`${p.latency_ms}ms`} />
        {p.retry_count > 0 && <MetricPill label="Retries" value={p.retry_count} />}
        {p.correlation_id && <MetricPill label="Correlation ID" value={p.correlation_id} />}
      </div>

      {/* System message */}
      {p.system_message && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            System Message
          </h4>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-gray-600 ring-1 ring-gray-200">
            {p.system_message}
          </pre>
        </div>
      )}

      {/* Prompt */}
      <div>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          Prompt
        </h4>
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-gray-600 ring-1 ring-gray-200">
          {p.prompt}
        </pre>
      </div>

      {/* Response */}
      {p.response && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Response
          </h4>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-xs text-gray-600 ring-1 ring-gray-200">
            {p.response}
          </pre>
        </div>
      )}

      {/* Error */}
      {p.error_message && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-red-400">
            Error
          </h4>
          <pre className="max-h-20 overflow-auto whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-600 ring-1 ring-red-200">
            {p.error_message}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------- Small components ---------------------------------------------------

function SortHeader({ col, label, sortBy, sortOrder, onClick }) {
  const active = sortBy === col;

  return (
    <th
      className="cursor-pointer select-none px-3 py-2.5 text-xs font-medium text-gray-500 hover:text-gray-700"
      onClick={() => onClick(col)}
    >
      <span className="flex items-center gap-1">
        {label}
        {active && (
          <svg className={`h-3 w-3 ${sortOrder === 'asc' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </span>
    </th>
  );
}

function StatusBadge({ status, cacheHit }) {
  if (cacheHit) {
    return <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">cached</span>;
  }

  const map = {
    success: 'bg-green-50 text-green-600',
    error: 'bg-red-50 text-red-600',
    timeout: 'bg-amber-50 text-amber-600',
  };

  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${map[status] || 'bg-gray-50 text-gray-500'}`}>
      {status}
    </span>
  );
}

function MetricPill({ label, value }) {
  return (
    <div className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-gray-200">
      <span className="text-[10px] text-gray-400">{label}</span>
      <span className="ml-1.5 text-xs font-medium text-gray-700">{value}</span>
    </div>
  );
}

// ---------- Helpers ------------------------------------------------------------

function formatCost(val) {
  const n = parseFloat(val) || 0;
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(3);
  return n.toFixed(4);
}

function formatNumber(val) {
  const n = parseInt(val) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function formatTokens(val) {
  const n = parseInt(val) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

function generatePageNumbers(current, total) {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = [1];
  if (current > 3) pages.push('...');
  for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) {
    pages.push(i);
  }
  if (current < total - 2) pages.push('...');
  pages.push(total);
  return pages;
}
