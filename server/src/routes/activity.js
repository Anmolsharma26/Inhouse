import { Router } from 'express';
import { Op } from 'sequelize';
import { ActivityEvent, ActivityDaily, TimeEntry, User } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { dayKey, httpError, teamIds } from '../utils/helpers.js';
import { logEvent, recordHeartbeat, liveState } from '../utils/activity.js';

const router = Router();
router.use(requireAuth);

const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const dayRange = (date) => { const start = new Date(`${date}T00:00:00`); return [start, new Date(start.getTime() + 86400000)]; };
const workedMinutes = (entries) => entries.reduce((s, e) => s + e.workedMinutes(), 0);

async function assertCanSee(req, userId) {
  if (Number(userId) === req.user.id) return;
  if (req.user.role === 'employee' || !(await teamIds(req.user)).includes(Number(userId))) throw httpError(403, 'Not your team member');
}

// ---------- sent by every open app tab ----------
router.post('/heartbeat', wrap(async (req, res) => {
  const { state, path } = req.body || {};
  res.json({ ok: true, counted: await recordHeartbeat(req.user.id, state, path) });
}));

// Only these event types may be reported by the browser; everything else is logged by the server itself.
const CLIENT_EVENTS = new Set(['page_view', 'idle_start', 'idle_end', 'logout']);
router.post('/event', wrap(async (req, res) => {
  const { type, path, detail } = req.body || {};
  if (!CLIENT_EVENTS.has(type)) throw httpError(400, 'Unknown event type');
  await logEvent(req.user.id, type, detail, type === 'logout' ? req : null, path);
  res.json({ ok: true });
}));

// ---------- a day for one user: totals, entries, timeline ----------
async function dayDetail(userId, date) {
  const [start, end] = dayRange(date);
  const [daily, entries, events] = await Promise.all([
    ActivityDaily.findOne({ where: { UserId: userId, date } }),
    TimeEntry.findAll({ where: { UserId: userId, date }, order: [['clockIn', 'ASC']] }),
    ActivityEvent.findAll({ where: { UserId: userId, createdAt: { [Op.gte]: start, [Op.lt]: end } }, order: [['createdAt', 'ASC']], limit: 1000 }),
  ]);
  return {
    date,
    activity: daily || { activeMinutes: 0, idleMinutes: 0, awayMinutes: 0, workActiveMinutes: 0, workIdleMinutes: 0, workAwayMinutes: 0, pages: {} },
    workedMinutes: workedMinutes(entries),
    entries: entries.map((e) => ({ ...e.toJSON(), workedMinutes: e.workedMinutes(), onBreak: e.isOnBreak() })),
    events,
  };
}

// The employee's own activity (transparency: everyone can see what is recorded about them)
router.get('/me', wrap(async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : dayKey();
  res.json(await dayDetail(req.user.id, date));
}));

// ---------- managers / admins ----------
// Live team board for one day (default today)
router.get('/team', requireRole('admin', 'manager'), wrap(async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : dayKey();
  const ids = await teamIds(req.user);
  const [users, dailies, entries] = await Promise.all([
    User.findAll({ where: { id: ids, isActive: true }, attributes: ['id', 'name', 'department', 'designation', 'role'], order: [['name', 'ASC']] }),
    ActivityDaily.findAll({ where: { UserId: ids, date } }),
    TimeEntry.findAll({ where: { UserId: ids, date }, order: [['clockIn', 'ASC']] }),
  ]);
  const byUser = Object.fromEntries(dailies.map((d) => [d.UserId, d]));
  res.json(users.map((u) => {
    const d = byUser[u.id];
    const mine = entries.filter((e) => e.UserId === u.id);
    const open = mine.find((e) => !e.clockOut);
    const worked = workedMinutes(mine);
    const tracked = (d?.workActiveMinutes || 0) + (d?.workIdleMinutes || 0) + (d?.workAwayMinutes || 0);
    return {
      ...u.toJSON(),
      state: date === dayKey() ? liveState(d) : null,
      clockedIn: !!open, onBreak: !!open?.isOnBreak(), clockedInSince: open?.clockIn || null,
      firstIn: mine[0]?.clockIn || null, lastOut: open ? null : mine.at(-1)?.clockOut || null,
      autoClosed: mine.some((e) => e.autoClosed),
      workedMinutes: worked,
      activeMinutes: d?.activeMinutes || 0, idleMinutes: d?.idleMinutes || 0, awayMinutes: d?.awayMinutes || 0,
      workActiveMinutes: d?.workActiveMinutes || 0, workIdleMinutes: d?.workIdleMinutes || 0, workAwayMinutes: d?.workAwayMinutes || 0,
      notInAppMinutes: Math.max(0, worked - tracked), // clocked in, but the app was not open
      activePercent: worked ? Math.min(100, Math.round(((d?.workActiveMinutes || 0) / worked) * 100)) : null,
      firstSeen: d?.firstSeen || null, lastSeen: d?.lastSeen || null, lastPath: d?.lastPath || null,
    };
  }));
}));

// One person's day (timeline)
router.get('/users/:id/day', requireRole('admin', 'manager'), wrap(async (req, res) => {
  await assertCanSee(req, req.params.id);
  const date = isDate(req.query.date) ? req.query.date : dayKey();
  const user = await User.findByPk(req.params.id, { attributes: ['id', 'name', 'department', 'designation'] });
  if (!user) throw httpError(404, 'User not found');
  res.json({ user, ...(await dayDetail(user.id, date)) });
}));

// One person's daily history (default last 14 days)
router.get('/users/:id/history', requireRole('admin', 'manager'), wrap(async (req, res) => {
  await assertCanSee(req, req.params.id);
  const to = isDate(req.query.to) ? req.query.to : dayKey();
  const from = isDate(req.query.from) ? req.query.from : dayKey(new Date(Date.now() - 13 * 86400000));
  const [dailies, entries] = await Promise.all([
    ActivityDaily.findAll({ where: { UserId: req.params.id, date: { [Op.between]: [from, to] } } }),
    TimeEntry.findAll({ where: { UserId: req.params.id, date: { [Op.between]: [from, to] } } }),
  ]);
  const days = {};
  for (const d of dailies) days[d.date] = { date: d.date, ...d.toJSON(), workedMinutes: 0 };
  for (const e of entries) (days[e.date] ||= { date: e.date, workedMinutes: 0, activeMinutes: 0, idleMinutes: 0, awayMinutes: 0, workActiveMinutes: 0 }).workedMinutes += e.workedMinutes();
  res.json(Object.values(days).sort((a, b) => b.date.localeCompare(a.date)));
}));

export default router;
