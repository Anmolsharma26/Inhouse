import { Router } from 'express';
import { Op } from 'sequelize';
import { TimeEntry, ManualTimeRequest, User, ActivityDaily } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { dayKey, httpError, teamIds } from '../utils/helpers.js';
import { logEvent, closeStaleEntries } from '../utils/activity.js';

const router = Router();
router.use(requireAuth);

const MAX_MANUAL_HOURS = 16;
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const openEntry = (UserId) => TimeEntry.findOne({ where: { UserId, clockOut: null }, order: [['clockIn', 'DESC']] });
const view = (e) => e && { ...e.toJSON(), workedMinutes: e.workedMinutes(), onBreak: e.isOnBreak() };

/** Existing time entry (or pending request) of the user that overlaps [start, end) */
async function findOverlap(UserId, start, end, { includePending = false, excludeRequestId } = {}) {
  const entry = await TimeEntry.findOne({
    where: { UserId, clockIn: { [Op.lt]: end }, [Op.or]: [{ clockOut: null }, { clockOut: { [Op.gt]: start } }] },
  });
  if (entry) return `overlaps an existing time entry (${new Date(entry.clockIn).toLocaleString()})`;
  if (includePending) {
    const reqRow = await ManualTimeRequest.findOne({
      where: { UserId, status: 'pending', clockIn: { [Op.lt]: end }, clockOut: { [Op.gt]: start }, ...(excludeRequestId && { id: { [Op.ne]: excludeRequestId } }) },
    });
    if (reqRow) return 'overlaps another pending request';
  }
  return null;
}

router.get('/today', wrap(async (req, res) => {
  await closeStaleEntries();
  const date = dayKey();
  const entries = await TimeEntry.findAll({ where: { UserId: req.user.id, date }, order: [['clockIn', 'ASC']] });
  // an entry started yesterday that is still open (night shift) also counts as "current"
  const open = await openEntry(req.user.id);
  if (open && !entries.some((e) => e.id === open.id)) entries.push(open);
  const breakMinutes = entries.reduce((s, e) => s + (e.breaks || []).reduce((b, br) => b + ((br.end ? new Date(br.end) : new Date()) - new Date(br.start)) / 60000, 0), 0);
  res.json({
    date, entries: entries.map(view),
    totalMinutes: entries.reduce((s, e) => s + e.workedMinutes(), 0),
    breakMinutes: Math.round(breakMinutes),
    workdayMinutes: Number(process.env.WORKDAY_MINUTES) || 480,
    lateAfter: process.env.LATE_AFTER || '09:30',
  });
}));

router.post('/clock-in', wrap(async (req, res) => {
  await closeStaleEntries();
  if (await openEntry(req.user.id)) throw httpError(400, 'Already clocked in');
  const e = await TimeEntry.create({ UserId: req.user.id, date: dayKey(), clockIn: new Date(), taskId: req.body.task || null });
  await logEvent(req.user.id, 'clock_in', null, req);
  res.status(201).json(view(e));
}));

router.post('/clock-out', wrap(async (req, res) => {
  const e = await openEntry(req.user.id);
  if (!e) throw httpError(400, 'Not clocked in');
  const now = new Date();
  e.breaks = e.breaks.map((b) => (b.end ? b : { ...b, end: now })); // close any open break
  e.clockOut = now;
  await e.save();
  await logEvent(req.user.id, 'clock_out', `worked ${e.workedMinutes()} min`, req);
  res.json(view(e));
}));

router.post('/break/start', wrap(async (req, res) => {
  const e = await openEntry(req.user.id);
  if (!e) throw httpError(400, 'Not clocked in');
  if (e.isOnBreak()) throw httpError(400, 'Already on break');
  e.breaks = [...e.breaks, { start: new Date() }];
  await e.save();
  await logEvent(req.user.id, 'break_start');
  res.json(view(e));
}));

router.post('/break/end', wrap(async (req, res) => {
  const e = await openEntry(req.user.id);
  if (!e || !e.isOnBreak()) throw httpError(400, 'Not on break');
  e.breaks = e.breaks.map((b) => (b.end ? b : { ...b, end: new Date() }));
  await e.save();
  await logEvent(req.user.id, 'break_end');
  res.json(view(e));
}));

// Timesheet rows (one per user per day) with overtime/late flags + in-app activity. Rules come from env.
export async function buildTimesheet(userIds, from, to) {
  const WORKDAY = Number(process.env.WORKDAY_MINUTES) || 480;
  const [lh, lm] = (process.env.LATE_AFTER || '09:30').split(':').map(Number);
  const [entries, dailies] = await Promise.all([
    TimeEntry.findAll({
      where: { UserId: userIds, date: { [Op.between]: [from, to] } },
      include: [{ model: User, attributes: ['id', 'name', 'department'] }],
      order: [['date', 'ASC'], ['clockIn', 'ASC']],
    }),
    ActivityDaily.findAll({ where: { UserId: userIds, date: { [Op.between]: [from, to] } } }),
  ]);
  const act = Object.fromEntries(dailies.map((d) => [`${d.UserId}|${d.date}`, d]));
  const byDay = new Map();
  for (const e of entries) {
    const key = `${e.UserId}|${e.date}`;
    const row = byDay.get(key) || { userId: e.UserId, name: e.User.name, department: e.User.department, date: e.date, firstIn: new Date(e.clockIn), lastOut: null, minutes: 0, breakMinutes: 0, open: false, autoClosed: false, manual: false };
    row.minutes += e.workedMinutes();
    row.breakMinutes += Math.round((e.breaks || []).reduce((s, b) => s + ((b.end ? new Date(b.end) : new Date()) - new Date(b.start)), 0) / 60000);
    if (!e.clockOut) row.open = true;
    row.lastOut = e.clockOut && (!row.lastOut || new Date(e.clockOut) > new Date(row.lastOut)) ? e.clockOut : row.lastOut;
    row.autoClosed ||= e.autoClosed; row.manual ||= e.source === 'manual';
    byDay.set(key, row);
  }
  return [...byDay.entries()].map(([key, r]) => {
    const late = r.firstIn.getHours() * 60 + r.firstIn.getMinutes() > lh * 60 + lm;
    const a = act[key];
    return {
      ...r, late, overtimeMinutes: Math.max(0, r.minutes - WORKDAY), shortfallMinutes: Math.max(0, WORKDAY - r.minutes),
      activeMinutes: a?.workActiveMinutes || 0, idleMinutes: a?.workIdleMinutes || 0, awayMinutes: a?.workAwayMinutes || 0,
    };
  });
}

router.get('/timesheet', wrap(async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : dayKey();
  const to = isDate(req.query.to) ? req.query.to : dayKey();
  res.json(await buildTimesheet([req.user.id], from, to));
}));

// ---------- Manual time-entry requests ----------
router.post('/manual-requests', wrap(async (req, res) => {
  const { date, reason } = req.body;
  const clockIn = new Date(req.body.clockIn), clockOut = new Date(req.body.clockOut);
  if (!isDate(date) || isNaN(clockIn) || isNaN(clockOut)) throw httpError(400, 'Date, start and end time are required');
  if (dayKey(clockIn) !== date) throw httpError(400, 'Start time must be on the selected date');
  if (clockOut <= clockIn) throw httpError(400, 'End time must be after start time');
  if (clockOut - clockIn > MAX_MANUAL_HOURS * 3600000) throw httpError(400, `A manual entry cannot be longer than ${MAX_MANUAL_HOURS} hours`);
  if (clockOut > new Date()) throw httpError(400, 'You cannot request time in the future');
  if (!String(reason || '').trim()) throw httpError(400, 'Please give a reason');
  const clash = await findOverlap(req.user.id, clockIn, clockOut, { includePending: true });
  if (clash) throw httpError(400, `This time ${clash}`);
  const r = await ManualTimeRequest.create({ UserId: req.user.id, date, clockIn, clockOut, reason: String(reason).trim().slice(0, 500) });
  await logEvent(req.user.id, 'manual_request', `${date} ${clockIn.toISOString()}–${clockOut.toISOString()}`);
  res.status(201).json(r);
}));

router.get('/manual-requests', wrap(async (req, res) => {
  const where = req.user.role === 'employee' || req.query.scope === 'mine' ? { UserId: req.user.id } : { UserId: await teamIds(req.user) };
  if (req.query.status) where.status = req.query.status;
  res.json(await ManualTimeRequest.findAll({
    where, order: [['createdAt', 'DESC']], limit: 100,
    include: [{ model: User, attributes: ['id', 'name'] }, { model: User, as: 'reviewer', attributes: ['id', 'name'] }],
  }));
}));

// Employee cancels their own pending request
router.delete('/manual-requests/:id', wrap(async (req, res) => {
  const r = await ManualTimeRequest.findOne({ where: { id: req.params.id, UserId: req.user.id, status: 'pending' } });
  if (!r) throw httpError(404, 'Pending request not found');
  await r.destroy();
  res.json({ ok: true });
}));

router.patch('/manual-requests/:id', wrap(async (req, res) => {
  const canApprove = req.user.role === 'admin' || (req.user.role === 'manager' && req.user.canApproveTime);
  if (!canApprove) throw httpError(403, 'You are not permitted to approve time entries');
  const r = await ManualTimeRequest.findByPk(req.params.id);
  if (!r || r.status !== 'pending') throw httpError(404, 'Pending request not found');
  if (r.UserId === req.user.id && req.user.role !== 'admin') throw httpError(403, 'You cannot approve your own request');
  if (req.user.role === 'manager' && !(await teamIds(req.user)).includes(r.UserId)) throw httpError(403, 'Not your team member');
  const approve = req.body.status === 'approved';
  if (approve) {
    const clash = await findOverlap(r.UserId, new Date(r.clockIn), new Date(r.clockOut));
    if (clash) throw httpError(400, `Cannot approve: this request ${clash}. Reject it or fix the existing entry.`);
  }
  await r.update({ status: approve ? 'approved' : 'rejected', reviewedBy: req.user.id, reviewNote: req.body.note || null });
  if (approve) {
    await TimeEntry.create({ UserId: r.UserId, date: r.date, clockIn: r.clockIn, clockOut: r.clockOut, source: 'manual', note: `Approved by ${req.user.name}: ${r.reason}`.slice(0, 300) });
  }
  res.json(r);
}));

export default router;
