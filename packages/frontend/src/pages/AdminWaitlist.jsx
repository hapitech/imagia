import { useState, useEffect } from 'react';
import { getWaitlistEntries, updateWaitlistEntry, deleteWaitlistEntry } from '../services/api';

const statusColors = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  invited: 'bg-blue-100 text-blue-800',
};

export default function AdminWaitlist() {
  const [entries, setEntries] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, rejected: 0, invited: 0 });
  const [filterStatus, setFilterStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function fetchEntries() {
    try {
      setLoading(true);
      const data = await getWaitlistEntries(filterStatus ? { status: filterStatus } : undefined);
      setEntries(data.entries);
      setStats(data.stats);
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load waitlist');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchEntries();
  }, [filterStatus]);

  async function handleStatusChange(id, newStatus) {
    try {
      await updateWaitlistEntry(id, { status: newStatus });
      fetchEntries();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to update');
    }
  }

  async function handleDelete(id) {
    if (!confirm('Remove this entry from the waitlist?')) return;
    try {
      await deleteWaitlistEntry(id);
      fetchEntries();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete');
    }
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-0">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Waitlist Management</h1>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-5">
        {[
          { label: 'Total', value: stats.total, color: 'bg-gray-100 text-gray-800' },
          { label: 'Pending', value: stats.pending, color: 'bg-yellow-50 text-yellow-800' },
          { label: 'Approved', value: stats.approved, color: 'bg-green-50 text-green-800' },
          { label: 'Rejected', value: stats.rejected, color: 'bg-red-50 text-red-800' },
          { label: 'Invited', value: stats.invited, color: 'bg-blue-50 text-blue-800' },
        ].map((s) => (
          <div key={s.label} className={`rounded-xl ${s.color} p-4 text-center`}>
            <div className="text-2xl font-bold">{s.value}</div>
            <div className="text-xs font-medium uppercase tracking-wide opacity-70">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="mb-4 flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Filter:</label>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="invited">Invited</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="py-12 text-center text-gray-500">Loading...</div>
      ) : entries.length === 0 ? (
        <div className="py-12 text-center text-gray-500">No waitlist entries yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 font-medium text-gray-600">Company</th>
                <th className="px-4 py-3 font-medium text-gray-600">Use Case</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Date</th>
                <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((entry) => (
                <tr key={entry.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{entry.email}</td>
                  <td className="px-4 py-3 text-gray-600">{entry.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{entry.company || '—'}</td>
                  <td className="max-w-[200px] truncate px-4 py-3 text-gray-600" title={entry.use_case}>
                    {entry.use_case || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[entry.status] || 'bg-gray-100'}`}>
                      {entry.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {entry.status !== 'approved' && (
                        <button
                          onClick={() => handleStatusChange(entry.id, 'approved')}
                          className="rounded px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
                        >
                          Approve
                        </button>
                      )}
                      {entry.status !== 'invited' && (
                        <button
                          onClick={() => handleStatusChange(entry.id, 'invited')}
                          className="rounded px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                        >
                          Invite
                        </button>
                      )}
                      {entry.status !== 'rejected' && (
                        <button
                          onClick={() => handleStatusChange(entry.id, 'rejected')}
                          className="rounded px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                        >
                          Reject
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(entry.id)}
                        className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
