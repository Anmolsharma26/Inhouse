import { User } from '../models/index.js';

// Local-day key used for attendance (YYYY-MM-DD)
export const dayKey = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export const httpError = (status, message) => Object.assign(new Error(message), { status });

export const pick = (obj, keys) =>
  Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k] === '' ? null : obj[k]]));

// IDs of users the given user oversees (admin: everyone; manager: self + direct reports)
export async function teamIds(user) {
  if (user.role === 'admin') return (await User.findAll({ where: { isActive: true }, attributes: ['id'] })).map((u) => u.id);
  const reports = await User.findAll({ where: { managerId: user.id }, attributes: ['id'] });
  return [user.id, ...reports.map((r) => r.id)];
}

export const escapeLike = (s) => String(s).replace(/[\\%_]/g, '\\$&');
