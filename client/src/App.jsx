import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { loadMe } from './store/authSlice';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Chat from './pages/Chat';
import Timesheet from './pages/Timesheet';
import Tasks from './pages/Tasks';
import Employees from './pages/Employees';
import Admin from './pages/Admin';

function Protected({ roles, children }) {
  const { user, status } = useSelector((s) => s.auth);
  if (status === 'loading') return <p className="p-8 text-slate-500">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const dispatch = useDispatch();
  useEffect(() => { if (localStorage.getItem('token')) dispatch(loadMe()); }, [dispatch]);

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><Layout /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="chat" element={<Chat />} />
        <Route path="time" element={<Timesheet />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="employees" element={<Employees />} />
        <Route path="admin" element={<Protected roles={['admin', 'manager']}><Admin /></Protected>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
