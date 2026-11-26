import { Router } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { User } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { httpError } from '../utils/helpers.js';
import { logEvent } from '../utils/activity.js';

const router = Router();
const sign = (u) => jwt.sign({ id: u.id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' });

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.scope('withSecrets').findOne({ where: { email: String(email || '').toLowerCase() } });
  if (!user || !user.isActive || !(await user.matchPassword(String(password || '')))) throw httpError(401, 'Invalid credentials');
  const safe = await User.findByPk(user.id);
  await logEvent(user.id, 'login', null, req);
  res.json({ token: sign(user), user: safe });
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Password reset: creates a token. TODO: email it (SMTP/SES). In dev the link is logged to the console.
router.post('/forgot-password', wrap(async (req, res) => {
  const user = await User.findOne({ where: { email: String(req.body.email || '').toLowerCase() } });
  if (user) {
    const raw = crypto.randomBytes(32).toString('hex');
    await user.update({ resetToken: crypto.createHash('sha256').update(raw).digest('hex'), resetExpires: new Date(Date.now() + 30 * 60 * 1000) });
    console.log(`[dev] password reset link: ${process.env.CLIENT_ORIGIN}/reset-password?token=${raw}`);
  }
  res.json({ message: 'If that email exists, a reset link has been sent.' });
}));

router.post('/reset-password', wrap(async (req, res) => {
  const hashed = crypto.createHash('sha256').update(String(req.body.token || '')).digest('hex');
  const user = await User.scope('withSecrets').findOne({ where: { resetToken: hashed, resetExpires: { [Op.gt]: new Date() } } });
  if (!user) throw httpError(400, 'Reset link is invalid or expired');
  await user.update({ password: req.body.password, resetToken: null, resetExpires: null });
  res.json({ message: 'Password updated' });
}));

export default router;
