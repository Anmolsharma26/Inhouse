import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Navigate } from 'react-router-dom';
import { login } from '../store/authSlice';
import api, { errMsg } from '../api/client';

export default function Login() {
  const dispatch = useDispatch();
  const { user, status, error } = useSelector((s) => s.auth);
  const [form, setForm] = useState({ email: '', password: '' });
  const [info, setInfo] = useState('');
  if (user) return <Navigate to="/" replace />;

  const forgot = async () => {
    if (!form.email) return setInfo('Enter your email first.');
    try { setInfo((await api.post('/auth/forgot-password', { email: form.email })).data.message); }
    catch (e) { setInfo(errMsg(e)); }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form className="card w-full max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); dispatch(login(form)); }}>
        <h1 className="text-xl font-bold text-brand-700">RadiantMap</h1>
        <p className="text-sm text-slate-500">Sign in to Chat & Time Tracker</p>
        <input className="input" type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
        <input className="input" type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
        {error && <p className="text-sm text-red-600">{error}</p>}
        {info && <p className="text-sm text-slate-600">{info}</p>}
        <button className="btn w-full" disabled={status === 'loading'}>Sign in</button>
        <button type="button" className="w-full text-sm text-brand-600 hover:underline" onClick={forgot}>Forgot password?</button>
      </form>
    </div>
  );
}
