import { useEffect, useState, useCallback } from 'react';
import api, { errMsg } from '../api/client';
import { fmt } from './Dashboard';

// Local calendar date (YYYY-MM-DD). toISOString() would use UTC and show the wrong day early in the morning.
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const STATUS_STYLE = { pending: 'bg-amber-100 text-amber-800', approved: 'bg-green-100 text-green-800', rejected: 'bg-red-100 text-red-700' };

export default function Timesheet() {
  const [today, setToday] = useState({ entries: [], totalMinutes: 0, breakMinutes: 0, workdayMinutes: 480 });
  const [activity, setActivity] = useState(null);
  const [rows, setRows] = useState([]);
  const [requests, setRequests] = useState([]);
  const [range, setRange] = useState('week');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(async () => {
    const to = new Date(), from = new Date();
    if (range === 'week') from.setDate(to.getDate() - 6);
    else if (range === 'month') from.setDate(1);
    else { from.setMonth(from.getMonth() - 1, 1); to.setDate(0); } // last month
    try {
      const [t, ts, a, r] = await Promise.all([
        api.get('/time/today'),
        api.get('/time/timesheet', { params: { from: localDate(from), to: localDate(to) } }),
        api.get('/activity/me'),
        api.get('/time/manual-requests', { params: { scope: 'mine' } }),
      ]);
      setToday(t.data); setRows([...ts.data].reverse()); setActivity(a.data.activity); setRequests(r.data);
    } catch (e) { setErr(errMsg(e)); }
  }, [range]);
  useEffect(() => { load(); }, [load]);
  // keep the running timer fresh
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 30000); const r = setInterval(load, 120000); return () => { clearInterval(t); clearInterval(r); }; }, [load]);

  const act = async (path) => {
    setErr(''); setBusy(true);
    try { await api.post(`/time/${path}`); await load(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const open = today.entries.find((e) => !e.clockOut);
  // live minutes: recompute the open entry on the client so the timer ticks between refreshes
  const liveMinutes = today.entries.reduce((s, e) => {
    if (e.clockOut) return s + e.workedMinutes;
    let ms = Date.now() - new Date(e.clockIn);
    for (const b of e.breaks || []) ms -= (b.end ? new Date(b.end) : Date.now()) - new Date(b.start);
    return s + Math.max(0, Math.round(ms / 60000));
  }, 0);
  const progress = Math.min(100, Math.round((liveMinutes / (today.workdayMinutes || 480)) * 100));
  const openBreak = open?.breaks?.find((b) => !b.end);
  const autoClosed = rows.filter((r) => r.autoClosed);
  const totals = rows.reduce((t, r) => ({ minutes: t.minutes + r.minutes, ot: t.ot + r.overtimeMinutes, active: t.active + (r.activeMinutes || 0), late: t.late + (r.late ? 1 : 0) }), { minutes: 0, ot: 0, active: 0, late: 0 });

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Time & Attendance</h2>

      {autoClosed.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          ⚠ You forgot to clock out on {autoClosed.map((r) => r.date).join(', ')}. The system clocked you out at your last activity.
          If the time is wrong, submit a manual time request below.
        </div>
      )}

      {/* ---------- Today ---------- */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <p className="text-sm text-slate-500">
              Today · {open ? (openBreak ? <span className="text-amber-600">On break since {hhmm(openBreak.start)}</span> : <span className="text-green-600">Working since {hhmm(open.clockIn)}</span>) : 'Not clocked in'}
            </p>
            <p className="text-3xl font-bold">{fmt(liveMinutes)}</p>
            <p className="text-xs text-slate-500">of {fmt(today.workdayMinutes)} workday · breaks {fmt(today.breakMinutes)} · on time if in before {today.lateAfter}</p>
          </div>
          {!open && <button className="btn" disabled={busy} onClick={() => act('clock-in')}>Clock in</button>}
          {open && !open.onBreak && <button className="btn-ghost" disabled={busy} onClick={() => act('break/start')}>Start break</button>}
          {open?.onBreak && <button className="btn-ghost" disabled={busy} onClick={() => act('break/end')}>End break</button>}
          {open && <button className="btn" disabled={busy} onClick={() => act('clock-out')}>Clock out</button>}
        </div>
        <div className="h-2 overflow-hidden rounded bg-slate-200"><div className={`h-full ${progress >= 100 ? 'bg-green-500' : 'bg-brand-500'}`} style={{ width: `${progress}%` }} /></div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {today.entries.length > 0 && (
          <ul className="space-y-1 text-sm">
            {today.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 text-slate-600">
                <span>🟢 {hhmm(e.clockIn)} → {e.clockOut ? hhmm(e.clockOut) : 'now'}</span>
                {(e.breaks || []).map((b, i) => <span key={i} className="text-amber-700">☕ {hhmm(b.start)}–{b.end ? hhmm(b.end) : 'now'}</span>)}
                {e.source === 'manual' && <span className="text-xs text-slate-400">(manual)</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- My activity (transparency) ---------- */}
      {activity && (
        <div className="card">
          <h3 className="mb-2 font-medium">Your activity in RadiantMap today</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Active" value={fmt(activity.activeMinutes)} cls="text-green-600" />
            <Stat label="Idle (no input 5+ min)" value={fmt(activity.idleMinutes)} cls="text-amber-600" />
            <Stat label="App in background" value={fmt(activity.awayMinutes)} cls="text-slate-500" />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            ℹ While RadiantMap is open, it records whether you are active, idle or in another tab, plus logins, clock events and pages visited.
            Your manager can see these totals. It does not see other apps or record what you type.
          </p>
        </div>
      )}

      {/* ---------- History ---------- */}
      <div className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Attendance history</h3>
          <select className="input w-auto" value={range} onChange={(e) => setRange(e.target.value)}>
            <option value="week">Last 7 days</option><option value="month">This month</option><option value="last">Last month</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-slate-500"><tr><th className="py-2">Date</th><th>In</th><th>Out</th><th>Worked</th><th>Break</th><th>Overtime</th><th>Active in app</th><th>Flags</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-t">
                  <td className="py-2">{r.date}</td>
                  <td>{hhmm(r.firstIn)}</td>
                  <td>{r.open ? 'working' : hhmm(r.lastOut)}</td>
                  <td>{fmt(r.minutes)}</td>
                  <td>{r.breakMinutes ? fmt(r.breakMinutes) : '—'}</td>
                  <td>{r.overtimeMinutes ? fmt(r.overtimeMinutes) : r.shortfallMinutes && !r.open ? <span className="text-slate-400">-{fmt(r.shortfallMinutes)}</span> : '—'}</td>
                  <td>{r.activeMinutes ? fmt(r.activeMinutes) : '—'}</td>
                  <td className="space-x-1">
                    {r.late && <Badge cls="bg-amber-100 text-amber-800">Late</Badge>}
                    {r.autoClosed && <Badge cls="bg-red-100 text-red-700">Auto clock-out</Badge>}
                    {r.manual && <Badge cls="bg-slate-100 text-slate-600">Manual</Badge>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="8" className="py-4 text-slate-500">No records in this period.</td></tr>}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t font-medium"><tr><td className="py-2">Total ({rows.length} days)</td><td /><td /><td>{fmt(totals.minutes)}</td><td /><td>{totals.ot ? fmt(totals.ot) : '—'}</td><td>{fmt(totals.active)}</td><td>{totals.late ? `${totals.late} late` : ''}</td></tr></tfoot>
            )}
          </table>
        </div>
      </div>

      <ManualRequests requests={requests} onChange={load} />
    </div>
  );
}

const Stat = ({ label, value, cls }) => <div className="rounded-lg bg-slate-50 p-2"><p className={`text-lg font-semibold ${cls}`}>{value}</p><p className="text-xs text-slate-500">{label}</p></div>;
const Badge = ({ cls, children }) => <span className={`rounded px-2 text-xs ${cls}`}>{children}</span>;

function ManualRequests({ requests, onChange }) {
  const [req, setReq] = useState({ date: localDate(), start: '09:00', end: '18:00', reason: '' });
  const [msg, setMsg] = useState({ text: '', ok: true });
  const overnight = req.end <= req.start;

  const submit = async (e) => {
    e.preventDefault();
    const clockIn = new Date(`${req.date}T${req.start}`);
    const clockOut = new Date(`${req.date}T${req.end}`);
    if (overnight) clockOut.setDate(clockOut.getDate() + 1); // shift past midnight
    try {
      await api.post('/time/manual-requests', { date: req.date, clockIn: clockIn.toISOString(), clockOut: clockOut.toISOString(), reason: req.reason });
      setMsg({ text: 'Request submitted for approval.', ok: true }); setReq({ ...req, reason: '' }); onChange();
    } catch (e2) { setMsg({ text: errMsg(e2), ok: false }); }
  };
  const cancel = async (id) => {
    try { await api.delete(`/time/manual-requests/${id}`); onChange(); } catch (e) { setMsg({ text: errMsg(e), ok: false }); }
  };

  return (
    <div className="card space-y-4">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-5">
        <div className="sm:col-span-5">
          <h3 className="font-medium">Request a manual time entry</h3>
          <p className="text-xs text-slate-500">For time you worked but could not clock (forgot, offline, wrong auto clock-out). Your manager must approve it.</p>
        </div>
        <input className="input" type="date" value={req.date} max={localDate()} onChange={(e) => setReq({ ...req, date: e.target.value })} required />
        <input className="input" type="time" value={req.start} onChange={(e) => setReq({ ...req, start: e.target.value })} required />
        <input className="input" type="time" value={req.end} onChange={(e) => setReq({ ...req, end: e.target.value })} required />
        <input className="input" placeholder="Reason" value={req.reason} maxLength={500} onChange={(e) => setReq({ ...req, reason: e.target.value })} required />
        <button className="btn">Submit</button>
        {overnight && <p className="text-xs text-amber-700 sm:col-span-5">End time is before start time, so it will count as ending the next day.</p>}
        {msg.text && <p className={`text-sm sm:col-span-5 ${msg.ok ? 'text-green-700' : 'text-red-600'}`}>{msg.text}</p>}
      </form>

      <div>
        <h4 className="mb-2 text-sm font-medium">My requests</h4>
        {requests.length === 0 ? <p className="text-sm text-slate-500">No requests yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-slate-500"><tr><th className="py-2">Date</th><th>Time</th><th>Reason</th><th>Status</th><th /></tr></thead>
              <tbody>
                {requests.map((r) => (
                  <tr key={r.id} className="border-t align-top">
                    <td className="py-2">{r.date}</td>
                    <td className="whitespace-nowrap">{hhmm(r.clockIn)}–{hhmm(r.clockOut)}</td>
                    <td className="max-w-xs">{r.reason}{r.reviewNote && <p className="text-xs text-slate-500">Note: {r.reviewNote}</p>}</td>
                    <td><Badge cls={STATUS_STYLE[r.status]}>{r.status}</Badge>{r.reviewer && <p className="text-xs text-slate-400">by {r.reviewer.name}</p>}</td>
                    <td>{r.status === 'pending' && <button className="text-xs text-red-600" onClick={() => cancel(r.id)}>Cancel</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
