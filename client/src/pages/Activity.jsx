import { useCallback, useEffect, useState } from 'react';
import api, { errMsg } from '../api/client';
import { fmt } from './Dashboard';
import { localDate } from './Timesheet';

const hhmm = (d) => (d ? new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
const STATE = {
  active: ['bg-green-500', 'Active'], idle: ['bg-amber-400', 'Idle'], away: ['bg-slate-400', 'Other tab/app'], offline: ['bg-slate-200', 'Offline'],
};
const PAGE_NAMES = { '/': 'Dashboard', '/chat': 'Chat', '/time': 'Time & Attendance', '/tasks': 'Tasks', '/employees': 'Directory', '/admin': 'Reports', '/activity': 'Team Activity' };
const pageName = (p) => PAGE_NAMES[p] || p || '—';
const EVENT = {
  login: ['🔑', 'Logged in'], logout: ['🚪', 'Logged out'], clock_in: ['🟢', 'Clocked in'], clock_out: ['🔴', 'Clocked out'],
  break_start: ['☕', 'Started break'], break_end: ['💼', 'Ended break'], idle_start: ['💤', 'Went idle'], idle_end: ['⚡', 'Back from idle'],
  page_view: ['📄', 'Opened'], message_sent: ['💬', 'Sent a chat message'], task_created: ['🆕', 'Created task'], task_updated: ['✏️', 'Updated task'],
  task_comment: ['🗨️', 'Commented on task'], manual_request: ['📝', 'Requested manual time'], auto_clock_out: ['⚠️', 'Auto clock-out'],
};

export default function Activity() {
  const [date, setDate] = useState(localDate());
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [selected, setSelected] = useState(null);
  const [updated, setUpdated] = useState(null);
  const isToday = date === localDate();

  const load = useCallback(() => api.get('/activity/team', { params: { date } })
    .then((r) => { setRows(r.data); setUpdated(new Date()); setErr(''); }).catch((e) => setErr(errMsg(e))), [date]);
  useEffect(() => { load(); if (!isToday) return; const t = setInterval(load, 30000); return () => clearInterval(t); }, [load, isToday]);

  const count = (fn) => rows.filter(fn).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-semibold">Team Activity</h2>
          <p className="text-xs text-slate-500">Activity inside RadiantMap only. {isToday && updated && `Live, updated ${hhmm(updated)}.`}</p>
        </div>
        <input className="input w-auto" type="date" value={date} max={localDate()} onChange={(e) => setDate(e.target.value || localDate())} />
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {isToday && <Kpi label="Active now" value={count((r) => r.state === 'active')} cls="text-green-600" />}
        {isToday && <Kpi label="Idle now" value={count((r) => r.state === 'idle')} cls="text-amber-600" />}
        <Kpi label={isToday ? 'Clocked in' : 'Attended'} value={isToday ? count((r) => r.clockedIn) : count((r) => r.firstIn)} />
        {isToday && <Kpi label="On break" value={count((r) => r.onBreak)} />}
        <Kpi label="Not clocked in" value={count((r) => !r.firstIn)} cls="text-red-600" />
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="p-3">Employee</th>{isToday && <th>Now</th>}<th>Attendance</th><th>Worked</th>
              <th title="Using the app while clocked in">Active</th><th title="App in front, no input for 5+ min, while clocked in">Idle</th>
              <th title="App in a background tab while clocked in">Other tab</th><th title="Clocked in, but RadiantMap was not open">Not in app</th>
              <th>Active %</th><th>Last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const [dot, label] = STATE[r.state || 'offline'];
              return (
                <tr key={r.id} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => setSelected(r)}>
                  <td className="p-3"><p className="font-medium">{r.name}</p><p className="text-xs text-slate-500">{r.designation || r.role}</p></td>
                  {isToday && <td><span className="flex items-center gap-1.5 whitespace-nowrap"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} />{label}</span>
                    {r.state !== 'offline' && r.lastPath && <p className="text-xs text-slate-400">{pageName(r.lastPath)}</p>}</td>}
                  <td className="whitespace-nowrap">
                    {!r.firstIn ? <span className="text-red-600">Not clocked in</span>
                      : r.onBreak ? <span className="text-amber-600">On break</span>
                      : r.clockedIn ? <span className="text-green-700">In since {hhmm(r.clockedInSince)}</span>
                      : <span>{hhmm(r.firstIn)} – {hhmm(r.lastOut)}</span>}
                    {r.autoClosed && <p className="text-xs text-red-600">Auto clock-out</p>}
                  </td>
                  <td>{fmt(r.workedMinutes)}</td>
                  <td className="text-green-700">{fmt(r.workActiveMinutes)}</td>
                  <td className="text-amber-700">{fmt(r.workIdleMinutes)}</td>
                  <td className="text-slate-500">{fmt(r.workAwayMinutes)}</td>
                  <td className="text-slate-500">{fmt(r.notInAppMinutes)}</td>
                  <td className="w-28">{r.activePercent == null ? '—' : (
                    <div className="flex items-center gap-1"><div className="h-1.5 w-14 overflow-hidden rounded bg-slate-200"><div className="h-full bg-green-500" style={{ width: `${r.activePercent}%` }} /></div><span className="text-xs">{r.activePercent}%</span></div>
                  )}</td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{hhmm(r.lastSeen)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan="10" className="p-4 text-slate-500">No team members.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        “Active %” = active minutes ÷ worked minutes. “Not in app” is time clocked in while RadiantMap was closed (meetings, other tools, offline work), so it is not necessarily idle time.
      </p>

      {selected && <PersonPanel person={selected} date={date} onClose={() => setSelected(null)} />}
    </div>
  );
}

const Kpi = ({ label, value, cls = '' }) => <div className="card p-3"><p className={`text-2xl font-bold ${cls}`}>{value}</p><p className="text-xs text-slate-500">{label}</p></div>;

function PersonPanel({ person, date, onClose }) {
  const [day, setDay] = useState(null);
  const [history, setHistory] = useState([]);
  const [d, setD] = useState(date);
  const [showPages, setShowPages] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    api.get(`/activity/users/${person.id}/day`, { params: { date: d } }).then((r) => setDay(r.data)).catch((e) => setErr(errMsg(e)));
  }, [person.id, d]);
  useEffect(() => { api.get(`/activity/users/${person.id}/history`).then((r) => setHistory(r.data)).catch(() => {}); }, [person.id]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);

  const a = day?.activity;
  const pages = Object.entries(a?.pages || {}).sort((x, y) => y[1] - x[1]);
  const events = (day?.events || []).filter((e) => showPages || e.type !== 'page_view');

  return (
    <div className="fixed inset-0 z-20 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-xl space-y-4 overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div><h3 className="text-lg font-semibold">{person.name}</h3><p className="text-xs text-slate-500">{person.designation || person.role} · {person.department || ''}</p></div>
          <button onClick={onClose} aria-label="Close">✕</button>
        </div>
        <input className="input w-auto" type="date" value={d} max={localDate()} onChange={(e) => setD(e.target.value || localDate())} />
        {err && <p className="text-sm text-red-600">{err}</p>}
        {!day ? <p className="text-sm text-slate-500">Loading…</p> : <>
          <div className="grid grid-cols-4 gap-2 text-center text-sm">
            <Mini label="Worked" value={fmt(day.workedMinutes)} />
            <Mini label="Active" value={fmt(a.workActiveMinutes)} cls="text-green-600" />
            <Mini label="Idle" value={fmt(a.workIdleMinutes)} cls="text-amber-600" />
            <Mini label="Other tab" value={fmt(a.workAwayMinutes)} cls="text-slate-500" />
          </div>
          <p className="text-xs text-slate-500">Whole day in app (incl. outside clocked hours): active {fmt(a.activeMinutes)}, idle {fmt(a.idleMinutes)}, other tab {fmt(a.awayMinutes)}.</p>

          <section>
            <h4 className="mb-1 text-sm font-semibold">Clock entries</h4>
            {day.entries.length === 0 ? <p className="text-sm text-slate-400">No clock entries.</p> : (
              <ul className="space-y-1 text-sm">
                {day.entries.map((e) => (
                  <li key={e.id}>🟢 {hhmm(e.clockIn)} → {e.clockOut ? hhmm(e.clockOut) : 'now'} <span className="text-slate-400">({fmt(e.workedMinutes)})</span>
                    {(e.breaks || []).map((b, i) => <span key={i} className="ml-2 text-amber-700">☕ {hhmm(b.start)}–{b.end ? hhmm(b.end) : 'now'}</span>)}
                    {e.autoClosed && <span className="ml-2 text-xs text-red-600">auto clock-out</span>}
                    {e.source === 'manual' && <span className="ml-2 text-xs text-slate-500">manual</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {pages.length > 0 && (
            <section>
              <h4 className="mb-1 text-sm font-semibold">Time per page (active)</h4>
              <ul className="space-y-1 text-sm">
                {pages.map(([p, m]) => (
                  <li key={p} className="flex items-center gap-2">
                    <span className="w-36 truncate">{pageName(p)}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded bg-slate-200"><div className="h-full bg-brand-500" style={{ width: `${(m / pages[0][1]) * 100}%` }} /></div>
                    <span className="w-14 text-right text-xs">{fmt(m)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <div className="mb-1 flex items-center justify-between">
              <h4 className="text-sm font-semibold">Timeline</h4>
              <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={showPages} onChange={(e) => setShowPages(e.target.checked)} />Show page visits</label>
            </div>
            {events.length === 0 ? <p className="text-sm text-slate-400">No activity recorded.</p> : (
              <ol className="space-y-1 border-l pl-3 text-sm">
                {events.map((e) => {
                  const [icon, text] = EVENT[e.type] || ['•', e.type];
                  return (
                    <li key={e.id}>
                      <span className="mr-2 text-xs text-slate-400">{hhmm(e.createdAt)}</span>{icon} {text}
                      {e.type === 'page_view' && <b> {pageName(e.path)}</b>}
                      {['task_created', 'task_updated', 'task_comment', 'auto_clock_out', 'clock_out'].includes(e.type) && e.detail && <span className="text-slate-500"> · {e.detail}</span>}
                      {e.type === 'login' && e.ip && <span className="text-xs text-slate-400"> · {e.ip}</span>}
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </>}

        <section>
          <h4 className="mb-1 text-sm font-semibold">Last 14 days</h4>
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500"><tr><th className="py-1">Date</th><th>Worked</th><th>Active</th><th>Idle</th><th>Active %</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.date} className="cursor-pointer border-t hover:bg-slate-50" onClick={() => setD(h.date)}>
                  <td className="py-1">{h.date}</td><td>{fmt(h.workedMinutes)}</td><td>{fmt(h.workActiveMinutes || 0)}</td><td>{fmt(h.workIdleMinutes || 0)}</td>
                  <td>{h.workedMinutes ? `${Math.min(100, Math.round(((h.workActiveMinutes || 0) / h.workedMinutes) * 100))}%` : '—'}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan="5" className="py-2 text-slate-400">No history yet.</td></tr>}
            </tbody>
          </table>
        </section>
      </aside>
    </div>
  );
}

const Mini = ({ label, value, cls = '' }) => <div className="rounded-lg bg-slate-50 p-2"><p className={`font-semibold ${cls}`}>{value}</p><p className="text-xs text-slate-500">{label}</p></div>;
