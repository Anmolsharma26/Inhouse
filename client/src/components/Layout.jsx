import { NavLink, Outlet } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/authSlice';

export default function Layout() {
  const dispatch = useDispatch();
  const user = useSelector((s) => s.auth.user);
  const links = [
    ['/', 'Dashboard'], ['/chat', 'Chat'], ['/time', 'Time & Attendance'], ['/tasks', 'Tasks'], ['/employees', 'Directory'],
    ...(user.role !== 'employee' ? [['/admin', 'Reports']] : []),
  ];
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white p-4 md:w-56 md:border-b-0 md:border-r">
        <h1 className="mb-4 text-lg font-bold text-brand-700">RadiantMap</h1>
        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {links.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) => `whitespace-nowrap rounded-md px-3 py-2 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t pt-4 text-sm">
          <p className="font-medium">{user.name}</p>
          <p className="mb-2 capitalize text-slate-500">{user.role}</p>
          <button className="btn-ghost w-full" onClick={() => dispatch(logout())}>Log out</button>
        </div>
      </aside>
      <main className="flex-1 p-4 md:p-6"><Outlet /></main>
    </div>
  );
}
