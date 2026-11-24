import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import api, { errMsg } from '../api/client';

export default function Employees() {
  const me = useSelector((s) => s.auth.user);
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'employee', department: '', designation: '' });
  const [err, setErr] = useState('');

  const load = () => api.get('/users', { params: { q } }).then((r) => setUsers(r.data));
  useEffect(() => { load(); }, [q]); // eslint-disable-line

  const create = async (e) => {
    e.preventDefault(); setErr('');
    try { await api.post('/users', form); setForm({ ...form, name: '', email: '', password: '' }); load(); } catch (e2) { setErr(errMsg(e2)); }
  };
  const toggle = async (u) => { await api.patch(`/users/${u.id}`, { isActive: !u.isActive }); load(); };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Employee directory</h2>
      {me.role === 'admin' && (
        <form onSubmit={create} className="card grid gap-3 sm:grid-cols-4">
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input className="input" type="password" placeholder="Temp password (min 8)" minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="employee">Employee</option><option value="manager">Manager / Team Leader</option><option value="admin">Admin</option>
          </select>
          <input className="input" placeholder="Department" value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          <input className="input" placeholder="Designation" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
          <button className="btn sm:col-span-2 sm:w-fit">Add employee</button>
          {err && <p className="text-sm text-red-600 sm:col-span-4">{err}</p>}
        </form>
      )}
      <input className="input max-w-xs" placeholder="Search by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-500"><tr><th className="py-2">Name</th><th>Role</th><th>Department</th><th>Designation</th><th>Manager</th><th>Status</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="py-2">{u.name}<div className="text-xs text-slate-500">{u.email}</div></td>
                <td className="capitalize">{u.role}</td><td>{u.department}</td><td>{u.designation}</td><td>{u.manager?.name || '—'}</td>
                <td>{me.role === 'admin' && u.id !== me.id
                  ? <button className="text-brand-600 hover:underline" onClick={() => toggle(u)}>{u.isActive ? 'Active · deactivate' : 'Inactive · activate'}</button>
                  : u.isActive ? 'Active' : 'Inactive'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
