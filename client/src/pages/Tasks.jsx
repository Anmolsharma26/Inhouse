import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import api, { errMsg } from '../api/client';

const STATUS = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' };

export default function Tasks() {
  const me = useSelector((s) => s.auth.user);
  const canCreate = me.role !== 'employee';
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ title: '', assigneeId: '', dueDate: '', priority: 'medium' });
  const [err, setErr] = useState('');

  const load = () => api.get('/tasks').then((r) => setTasks(r.data));
  useEffect(() => { load(); if (canCreate) api.get('/users').then((r) => setUsers(r.data.filter((u) => u.isActive))); }, [canCreate]);

  const create = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post('/tasks', form); setForm({ ...form, title: '' }); load(); } catch (e2) { setErr(errMsg(e2)); }
  };
  const setStatus = async (id, status) => { await api.patch(`/tasks/${id}`, { status }); load(); };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Tasks</h2>
      {canCreate && (
        <form onSubmit={create} className="card grid gap-3 sm:grid-cols-5">
          <input className="input sm:col-span-2" placeholder="Task title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
          <select className="input" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} required>
            <option value="">Assign to…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input className="input" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} />
          <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
          </select>
          <button className="btn sm:col-span-5 sm:w-fit">Create task</button>
          {err && <p className="text-sm text-red-600 sm:col-span-5">{err}</p>}
        </form>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        {Object.entries(STATUS).map(([key, label]) => (
          <div key={key} className="card">
            <h3 className="mb-2 font-medium">{label} <span className="text-slate-400">({tasks.filter((t) => t.status === key).length})</span></h3>
            <div className="space-y-2">
              {tasks.filter((t) => t.status === key).map((t) => {
                const overdue = t.dueDate && key !== 'completed' && new Date(t.dueDate) < new Date();
                return (
                  <div key={t.id} className="rounded-md border p-2 text-sm">
                    <p className="font-medium">{t.title}</p>
                    <p className="text-xs text-slate-500">{t.assignee?.name} · {t.priority}{t.dueDate && <span className={overdue ? 'text-red-600' : ''}> · due {new Date(t.dueDate).toLocaleDateString()}</span>}</p>
                    <select className="mt-2 rounded border text-xs" value={t.status} onChange={(e) => setStatus(t.id, e.target.value)}>
                      {Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
