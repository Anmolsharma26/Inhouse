import { useEffect, useState, useCallback } from 'react';
import api, { errMsg } from '../api/client';
import { fmt } from './Dashboard';

const iso = (d) => d.toISOString().slice(0, 10);

export default function Timesheet() {
  const [today, setToday] = useState({ entries: [], totalMinutes: 0 });
  const [rows, setRows] = useState([]);
  const [range, setRange] = useState('week');
  const [err, setErr] = useState('');
  const [req, setReq] = useState({ date: iso(new Date()), start: '09:00', end: '18:00', reason: '' });
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const to = new Date(), from = new Date();
    range === 'week' ? from.setDate(to.getDate() - 6) : from.setDate(1);
    const [t, ts] = await Promise.all([api.get('/time/today'), api.get('/time/timesheet', { params: { from: iso(from), to: iso(to) } })]);
    setToday(t.data); setRows(ts.data);
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const act = async (path) => { setErr(''); try { await api.post(`/time/${path}`); await load(); } catch (e) { setErr(errMsg(e)); } };
  const open = today.entries.find((e) => !e.clockOut);

  const submitManual = async (e) => {
    e.preventDefault();
    try {
      await api.post('/time/manual-requests', { date: req.date, clockIn: `${req.date}T${req.start}`, clockOut: `${req.date}T${req.end}`, reason: req.reason });
      setMsg('Request submitted for approval.'); setReq({ ...req, reason: '' });
    } catch (e2) { setMsg(errMsg(e2)); }
  };

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-3">
        <div className="mr-auto"><p className="text-sm text-slate-500">Today</p><p className="text-2xl font-bold">{fmt(today.totalMinutes)}</p></div>
        {!open && <button className="btn" onClick={() => act('clock-in')}>Clock in</button>}
        {open && !open.onBreak && <button className="btn-ghost" onClick={() => act('break/start')}>Start break</button>}
        {open?.onBreak && <button className="btn-ghost" onClick={() => act('break/end')}>End break</button>}
        {open && <button className="btn" onClick={() => act('clock-out')}>Clock out</button>}
        {err && <p className="w-full text-sm text-red-600">{err}</p>}
      </div>

      <div className="card">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium">Attendance history</h3>
          <select className="input w-auto" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="week">Last 7 days</option><option value="month">This month</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-2">Date</th><th>In</th><th>Out</th><th>Worked</th><th>Overtime</th><th>Flags</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-t">
                  <td className="py-2">{r.date}</td>
                  <td>{new Date(r.firstIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{r.lastOut ? new Date(r.lastOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                  <td>{fmt(r.minutes)}</td><td>{r.overtimeMinutes ? fmt(r.overtimeMinutes) : '—'}</td>
                  <td>{r.late && <span className="rounded bg-amber-100 px-2 text-xs text-amber-800">Late</span>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="6" className="py-4 text-slate-500">No records yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <form onSubmit={submitManual} className="card grid gap-3 sm:grid-cols-5">
        <h3 className="font-medium sm:col-span-5">Request a manual time entry</h3>
        <input className="input" type="date" value={req.date} onChange={(e) => setReq({ ...req, date: e.target.value })} required />
        <input className="input" type="time" value={req.start} onChange={(e) => setReq({ ...req, start: e.target.value })} required />
        <input className="input" type="time" value={req.end} onChange={(e) => setReq({ ...req, end: e.target.value })} required />
        <input className="input" placeholder="Reason" value={req.reason} onChange={(e) => setReq({ ...req, reason: e.target.value })} required />
        <button className="btn">Submit</button>
        {msg && <p className="text-sm text-slate-600 sm:col-span-5">{msg}</p>}
      </form>
    </div>
  );
}
