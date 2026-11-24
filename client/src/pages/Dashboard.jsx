import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import api from '../api/client';

export const fmt = (min = 0) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;

export default function Dashboard() {
  const user = useSelector((s) => s.auth.user);
  const [today, setToday] = useState({ totalMinutes: 0, entries: [] });
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    api.get('/time/today').then((r) => setToday(r.data));
    api.get('/tasks', { params: { scope: 'mine' } }).then((r) => setTasks(r.data));
  }, []);

  const open = tasks.filter((t) => t.status !== 'completed');
  const status = today.entries.find((e) => !e.clockOut);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Welcome, {user.name.split(' ')[0]}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card"><p className="text-sm text-slate-500">Worked today</p><p className="text-2xl font-bold">{fmt(today.totalMinutes)}</p></div>
        <div className="card"><p className="text-sm text-slate-500">Status</p><p className="text-2xl font-bold">{status ? (status.onBreak ? 'On break' : 'Working') : 'Clocked out'}</p></div>
        <div className="card"><p className="text-sm text-slate-500">Open tasks</p><p className="text-2xl font-bold">{open.length}</p></div>
      </div>
      <div className="card">
        <h3 className="mb-2 font-medium">My upcoming tasks</h3>
        {open.length === 0 && <p className="text-sm text-slate-500">Nothing pending 🎉</p>}
        <ul className="divide-y">
          {open.slice(0, 5).map((t) => (
            <li key={t.id} className="flex justify-between py-2 text-sm">
              <span>{t.title}</span>
              <span className="text-slate-500">{t.dueDate ? new Date(t.dueDate).toLocaleDateString() : 'No due date'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
