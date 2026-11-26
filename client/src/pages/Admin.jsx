import { useEffect, useState } from 'react';
import api, { errMsg } from '../api/client';
import { fmt } from './Dashboard';

const iso = (d) => d.toISOString().slice(0, 10);

export default function Admin() {
  const [sum, setSum] = useState(null);
  const [rows, setRows] = useState([]);
  const [pending, setPending] = useState([]);
  const [from, setFrom] = useState(iso(new Date(Date.now() - 6 * 864e5)));
  const [to, setTo] = useState(iso(new Date()));
  const [err, setErr] = useState('');

  const loadRows = () => api.get('/reports/timesheets', { params: { from, to } }).then((r) => setRows(r.data));
  const loadPending = () => api.get('/time/manual-requests', { params: { status: 'pending' } }).then((r) => setPending(r.data));
  useEffect(() => { api.get('/reports/summary').then((r) => setSum(r.data)); loadPending(); }, []);
  useEffect(() => { loadRows(); }, [from, to]); // eslint-disable-line

  const review = async (id, status) => {
    try { await api.patch(`/time/manual-requests/${id}`, { status }); loadPending(); loadRows(); } catch (e) { setErr(errMsg(e)); }
  };

  const exportXlsx = async () => {
    const r = await api.get('/reports/timesheets/export.xlsx', { params: { from, to }, responseType: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(r.data); a.download = `timesheets_${from}_${to}.xlsx`; a.click();
  };

  const stats = sum && [
    ['Total employees', sum.totalEmployees], ['Active', sum.activeEmployees], ['Working now', sum.currentlyWorking],
    ['Present today', sum.presentToday], ['Hours today', fmt(sum.minutesWorkedToday)], ['Overdue tasks', sum.overdueTasks],
    ['Pending tasks', sum.tasks.pending || 0], ['Completed tasks', sum.tasks.completed || 0],
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Reports</h2>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats?.map(([l, v]) => <div key={l} className="card"><p className="text-sm text-slate-500">{l}</p><p className="text-2xl font-bold">{v}</p></div>)}
      </div>

      {pending.length > 0 && (
        <div className="card">
          <h3 className="mb-2 font-medium">Manual time requests awaiting approval</h3>
          {err && <p className="text-sm text-red-600">{err}</p>}
          {pending.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-2 text-sm">
              <span>{p.User.name} · {p.date} · {new Date(p.clockIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–{new Date(p.clockOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ({fmt(Math.round((new Date(p.clockOut) - new Date(p.clockIn)) / 60000))}) · {p.reason}</span>
              <span className="flex gap-2"><button className="btn" onClick={() => review(p.id, 'approved')}>Approve</button><button className="btn-ghost" onClick={() => review(p.id, 'rejected')}>Reject</button></span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="mr-auto font-medium">Timesheets</h3>
          <input className="input w-auto" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input w-auto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn-ghost" onClick={exportXlsx}>Export Excel</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-2">Employee</th><th>Dept</th><th>Date</th><th>Worked</th><th>Overtime</th><th>Break</th><th>Active in app</th><th>Idle</th><th>Flags</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId + r.date} className="border-t"><td className="py-2">{r.name}</td><td>{r.department}</td><td>{r.date}</td><td>{fmt(r.minutes)}</td><td>{r.overtimeMinutes ? fmt(r.overtimeMinutes) : '—'}</td><td>{r.breakMinutes ? fmt(r.breakMinutes) : '—'}</td><td>{fmt(r.activeMinutes || 0)}</td><td>{fmt(r.idleMinutes || 0)}</td><td className="text-xs">{[r.late && 'Late', r.autoClosed && 'Auto clock-out', r.manual && 'Manual', r.open && 'Working'].filter(Boolean).join(', ')}</td></tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="9" className="py-4 text-slate-500">No data for this range.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
