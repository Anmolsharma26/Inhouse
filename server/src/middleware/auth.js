import jwt from 'jsonwebtoken';
import { User } from '../models/index.js';

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Not authenticated' });
    const { id } = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findByPk(id);
    if (!user || !user.isActive) return res.status(401).json({ message: 'Account inactive' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' });
  }
}

// Server-side RBAC: requireRole('admin', 'manager')
export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ message: 'Forbidden' });
