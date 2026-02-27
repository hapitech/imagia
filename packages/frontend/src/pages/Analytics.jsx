import { useState, useEffect, useMemo } from 'react';
import { getLLMCosts, getLLMCostsByModel, getFullCostSummary } from '../services/api';

const TIME_RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '1y', days: 365 },
];

export default function Analytics() {
  const [days, setDays] = useState(30);
  const [llmData, setLlmData] = useState(null);
  const [modelData, setModelData] = useState(null);
  const [fullCosts, setFullCosts] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview'); // overview | models | breakdown

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const [llm, models, costs] = await Promise.all([
          getLLMCosts({ days }),
          getLLMCostsByModel({ days }),
          getFullCostSummary({ days }),
        ]);
        if (!cancelled) {
          setLlmData(llm);
          setModelData(models);
          setFullCosts(costs);
        }
      } catch (err) {
        console.error('Failed to load analytics:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [days]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-indigo-500 border-t-transparent" />
      </div>
    );
  }

  const summary = llmData?.summary || {};
  const costSummary = fullCosts || {};

  return (
    <div className="h-full overflow-y-auto">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
            <p className="mt-1 text-sm text-gray-500">
              Track usage, costs, and performance across all providers
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1">
            {TIME_RANGES.map(({ label, days: d }) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === d
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="px-8 pt-6">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <SummaryCard
            label="Total Cost"
            value={`$${formatCost(costSummary.total_cost ?? summary.total_cost)}`}
            sub={`${days}d total`}
            color="indigo"
          />
          <SummaryCard
            label="LLM Requests"
            value={formatNumber(summary.total_requests)}
            sub={`${Math.round(summary.total_requests / days)}/day avg`}
            color="blue"
          />
          <SummaryCard
            label="Total Tokens"
            value={formatTokens(summary.total_tokens)}
            sub="input + output"
            color="emerald"
          />
          <SummaryCard
            label="Avg Latency"
            value={`${Math.round(summary.avg_latency_ms)}ms`}
            sub="per request"
            color="amber"
          />
        </div>
      </div>

      {/* Full cost breakdown cards (LLM + deploy + storage) */}
      {costSummary.llm !== undefined && (
        <div className="px-8 pt-4">
          <div className="grid grid-cols-3 gap-4">
            <MiniCard label="LLM Costs" value={`$${formatCost(costSummary.llm)}`} />
            <MiniCard label="Deployment Costs" value={`$${formatCost(costSummary.deployment)}`} />
            <MiniCard label="Storage Costs" value={`$${formatCost(costSummary.storage)}`} />
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 px-8 pt-6">
        <div className="flex gap-4">
          {[
            { key: 'overview', label: 'Daily Trend' },
            { key: 'models', label: 'By Model' },
            { key: 'breakdown', label: 'By Provider & Task' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`border-b-2 pb-2 text-sm font-medium transition-colors ${
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

      {/* Tab content */}
      <div className="p-8">
        {activeTab === 'overview' && <DailyTrendChart data={llmData?.daily_trend || []} />}
        {activeTab === 'models' && <ModelBreakdown data={modelData?.by_model || []} />}
        {activeTab === 'breakdown' && (
          <ProviderTaskBreakdown
            byProvider={llmData?.by_provider || []}
            byTask={llmData?.by_task || []}
          />
        )}
      </div>
    </div>
  );
}

// ---------- Summary Card -------------------------------------------------------

function SummaryCard({ label, value, sub, color }) {
  const colorMap = {
    indigo: 'bg-indigo-50 text-indigo-600',
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${colorMap[color]?.split(' ')[1] || 'text-gray-900'}`}>
        {value}
      </p>
      <p className="mt-1 text-[11px] text-gray-400">{sub}</p>
    </div>
  );
}

function MiniCard({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-[11px] font-medium text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-gray-700">{value}</p>
    </div>
  );
}

// ---------- Daily Trend Chart (CSS bar chart) ----------------------------------

function DailyTrendChart({ data }) {
  const maxCost = useMemo(() => Math.max(...data.map((d) => parseFloat(d.cost) || 0), 0.001), [data]);
  const maxReqs = useMemo(() => Math.max(...data.map((d) => parseInt(d.requests) || 0), 1), [data]);

  if (data.length === 0) {
    return <EmptyState text="No usage data for this period" />;
  }

  return (
    <div>
      <h3 className="mb-4 text-sm font-semibold text-gray-700">Daily Cost & Requests</h3>
      <div className="overflow-x-auto">
        <div className="flex items-end gap-1" style={{ minWidth: data.length * 28 }}>
          {data.map((day) => {
            const costPct = ((parseFloat(day.cost) || 0) / maxCost) * 100;
            const reqPct = ((parseInt(day.requests) || 0) / maxReqs) * 100;
            const dateLabel = new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

            return (
              <div key={day.date} className="group flex flex-col items-center" style={{ flex: '1 0 24px' }}>
                {/* Tooltip */}
                <div className="pointer-events-none mb-1 hidden rounded bg-gray-800 px-2 py-1 text-[10px] text-white shadow-lg group-hover:block">
                  <div>{dateLabel}</div>
                  <div>${formatCost(day.cost)}</div>
                  <div>{day.requests} reqs</div>
                </div>
                {/* Bars */}
                <div className="flex h-32 items-end gap-0.5">
                  <div
                    className="w-2.5 rounded-t bg-indigo-400 transition-all group-hover:bg-indigo-500"
                    style={{ height: `${Math.max(costPct, 2)}%` }}
                    title={`$${formatCost(day.cost)}`}
                  />
                  <div
                    className="w-2.5 rounded-t bg-blue-200 transition-all group-hover:bg-blue-300"
                    style={{ height: `${Math.max(reqPct, 2)}%` }}
                    title={`${day.requests} requests`}
                  />
                </div>
                <span className="mt-1 text-[9px] text-gray-400 [writing-mode:vertical-lr]">
                  {dateLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-3 flex gap-4 text-[10px] text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded bg-indigo-400" /> Cost
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded bg-blue-200" /> Requests
        </span>
      </div>
    </div>
  );
}

// ---------- Model Breakdown ----------------------------------------------------

function ModelBreakdown({ data }) {
  if (data.length === 0) {
    return <EmptyState text="No model usage data" />;
  }

  const totalCost = data.reduce((s, d) => s + parseFloat(d.cost || 0), 0) || 1;

  return (
    <div>
      <h3 className="mb-4 text-sm font-semibold text-gray-700">Usage by Model</h3>
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2.5 text-xs font-medium text-gray-500">Provider / Model</th>
              <th className="px-4 py-2.5 text-xs font-medium text-gray-500 text-right">Requests</th>
              <th className="px-4 py-2.5 text-xs font-medium text-gray-500 text-right">Tokens</th>
              <th className="px-4 py-2.5 text-xs font-medium text-gray-500 text-right">Cost</th>
              <th className="px-4 py-2.5 text-xs font-medium text-gray-500 text-right">Avg Latency</th>
              <th className="px-4 py-2.5 text-xs font-medium text-gray-500 text-right">Errors</th>
              <th className="px-4 py-2.5 text-xs font-medium text-gray-500 text-right">Cache Hits</th>
              <th className="px-4 py-2.5 text-xs font-medium text-gray-500" style={{ width: 120 }}>Share</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {data.map((row, i) => {
              const cost = parseFloat(row.cost || 0);
              const pct = (cost / totalCost) * 100;

              return (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5">
                    <span className="text-xs font-medium text-gray-400">{row.provider}</span>
                    <span className="mx-1 text-gray-300">/</span>
                    <span className="text-sm font-medium text-gray-700">{row.model}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm text-gray-600">
                    {formatNumber(row.requests)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm text-gray-600">
                    {formatTokens(row.tokens)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900">
                    ${formatCost(cost)}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm text-gray-600">
                    {Math.round(parseFloat(row.avg_latency_ms))}ms
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm text-gray-600">
                    {parseInt(row.error_count) > 0 ? (
                      <span className="text-red-500">{row.error_count}</span>
                    ) : (
                      <span className="text-gray-300">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm text-gray-600">
                    {row.cache_hit_count}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-indigo-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-10 text-right text-[10px] text-gray-400">
                        {pct.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Provider & Task Breakdown ------------------------------------------

function ProviderTaskBreakdown({ byProvider, byTask }) {
  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div>
        <h3 className="mb-4 text-sm font-semibold text-gray-700">By Provider</h3>
        {byProvider.length === 0 ? (
          <EmptyState text="No provider data" />
        ) : (
          <BreakdownList items={byProvider} labelKey="provider" />
        )}
      </div>
      <div>
        <h3 className="mb-4 text-sm font-semibold text-gray-700">By Task Type</h3>
        {byTask.length === 0 ? (
          <EmptyState text="No task data" />
        ) : (
          <BreakdownList items={byTask} labelKey="task_type" />
        )}
      </div>
    </div>
  );
}

function BreakdownList({ items, labelKey }) {
  const total = items.reduce((s, i) => s + parseFloat(i.cost || 0), 0) || 1;
  const colors = ['bg-indigo-400', 'bg-blue-400', 'bg-emerald-400', 'bg-amber-400', 'bg-rose-400', 'bg-violet-400'];

  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        const cost = parseFloat(item.cost || 0);
        const pct = (cost / total) * 100;

        return (
          <div key={item[labelKey]} className="rounded-lg border border-gray-100 p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700 capitalize">
                {item[labelKey]?.replace(/_/g, ' ')}
              </span>
              <span className="text-sm font-semibold text-gray-900">${formatCost(cost)}</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className={`h-full rounded-full ${colors[i % colors.length]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="w-10 text-right text-[10px] text-gray-400">{pct.toFixed(1)}%</span>
            </div>
            <div className="mt-1.5 flex gap-4 text-[10px] text-gray-400">
              <span>{formatNumber(item.requests)} requests</span>
              <span>{formatTokens(item.tokens)} tokens</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Shared helpers -----------------------------------------------------

function EmptyState({ text }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <svg className="mb-3 h-10 w-10 text-gray-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
      <p className="text-xs text-gray-400">{text}</p>
    </div>
  );
}

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
