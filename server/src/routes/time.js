import { Router } from 'express';
import { Op } from 'sequelize';
import { TimeEntry, ManualTimeRequest, User } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { dayKey, httpError, teamIds } from '../utils/helpers.js';

const router = Router();
router.use(requireAuth);

const openEntry = (UserId) => TimeEntry.findOne({ where: { UserId, clockOut: null }, order: [['clockIn', 'DESC']] });
const view = (e) => e && { ...e.toJSON(), workedMinutes: e.workedMinutes(), onBreak: e.isOnBreak() };

router.get('/today', wrap(async (req, res) => {
  const entries = await TimeEntry.findAll({ where: { UserId: req.user.id, date: dayKey() }, order: [['clockIn', 'ASC']] });
  res.json({ entries: entries.map(view), totalMinutes: entries.reduce((s, e) => s + e.workedMinutes(), 0) });
}));

router.post('/clock-in', wrap(async (req, res) => {
  if (await openEntry(req.user.id)) throw httpError(400, 'Already clocked in');
  const e = await TimeEntry.create({ UserId: req.user.id, date: dayKey(), clockIn: new Date(), taskId: req.body.task || null });
  res.status(201).json(view(e));
}));

router.post('/clock-out', wrap(async (req, res) => {
  const e = await openEntry(req.user.id);
  if (!e) throw httpError(400, 'Not clocked in');
  const now = new Date();
  e.breaks = e.breaks.map((b) => (b.end ? b : { ...b, end: now })); // close any open break
  e.clockOut = now;
  await e.save();
  res.json(view(e));
}));

router.post('/break/start', wrap(async (req, res) => {
  const e = await openEntry(req.user.id);
  if (!e) throw httpError(400, 'Not clocked in');
  if (e.isOnBreak()) throw httpError(400, 'Already on break');
  e.breaks = [...e.breaks, { start: new Date() }];
  await e.save();
  res.json(view(e));
}));

router.post('/break/end', wrap(async (req, res) => {
  const e = await openEntry(req.user.id);
  if (!e || !e.isOnBreak()) throw httpError(400, 'Not on break');
  e.breaks = e.breaks.map((b) => (b.end ? b : { ...b, end: new Date() }));
  await e.save();
  res.json(view(e));
}));

// Timesheet rows (one per user per day) with overtime/late flags. Rules come from env until RadiantMap confirms them.
export async function buildTimesheet(userIds, from, to) {
  const WORKDAY = Number(process.env.WORKDAY_MINUTES) || 480;
  const [lh, lm] = (process.env.LATE_AFTER || '09:30').split(':').map(Number);
  const entries = await TimeEntry.findAll({
    where: { UserId: userIds, date: { [Op.between]: [from, to] } },
    include: [{ model: User, attributes: ['id', 'name', 'department'] }],
    order: [['date', 'ASC'], ['clockIn', 'ASC']],
  });
  const byDay = new Map();
  for (const e of entries) {
    const key = `${e.UserId}|${e.date}`;
    const row = byDay.get(key) || { userId: e.UserId, name: e.User.name, department: e.User.department, date: e.date, firstIn: new Date(e.clockIn), lastOut: null, minutes: 0 };
    row.minutes += e.workedMinutes();
    row.lastOut = e.clockOut || row.lastOut;
    byDay.set(key, row);
  }
  return [...byDay.values()].map((r) => {
    const late = r.firstIn.getHours() * 60 + r.firstIn.getMinutes() > lh * 60 + lm;
    return { ...r, late, overtimeMinutes: Math.max(0, r.minutes - WORKDAY), shortfallMinutes: Math.max(0, WORKDAY - r.minutes) };
  });
}

router.get('/timesheet', wrap(async (req, res) => {
  const { from = dayKey(), to = dayKey() } = req.query;
  res.json(await buildTimesheet([req.user.id], from, to));
}));

// Manual time-entry requests
router.post('/manual-requests', wrap(async (req, res) => {
  const { date, clockIn, clockOut, reason } = req.body;
  if (new Date(clockOut) <= new Date(clockIn)) throw httpError(400, 'Clock-out must be after clock-in');
  res.status(201).json(await ManualTimeRequest.create({ UserId: req.user.id, date, clockIn, clockOut, reason }));
}));

router.get('/manual-requests', wrap(async (req, res) => {
  const where = req.user.role === 'employee' ? { UserId: req.user.id } : { UserId: await teamIds(req.user) };
  if (req.query.status) where.status = req.query.status;
  res.json(await ManualTimeRequest.findAll({ where, order: [['createdAt', 'DESC']], include: [{ model: User, attributes: ['id', 'name'] }] }));
}));

router.patch('/manual-requests/:id', wrap(async (req, res) => {
  const canApprove = req.user.role === 'admin' || (req.user.role === 'manager' && req.user.canApproveTime);
  if (!canApprove) throw httpError(403, 'You are not permitted to approve time entries');
  const r = await ManualTimeRequest.findByPk(req.params.id);
  if (!r || r.status !== 'pending') throw httpError(404, 'Pending request not found');
  if (req.user.role === 'manager' && !(await teamIds(req.user)).includes(r.UserId)) throw httpError(403, 'Not your team member');
  await r.update({ status: req.body.status === 'approved' ? 'approved' : 'rejected', reviewedBy: req.user.id, reviewNote: req.body.note });
  if (r.status === 'approved') {
    await TimeEntry.create({ UserId: r.UserId, date: r.date, clockIn: r.clockIn, clockOut: r.clockOut, source: 'manual' });
  }
  res.json(r);
}));

export default router;
