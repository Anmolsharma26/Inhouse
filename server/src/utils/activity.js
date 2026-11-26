// In-app activity tracking. Only records what happens inside RadiantMap (never message contents or keystrokes).
import { Op } from 'sequelize';
import { ActivityEvent, ActivityDaily, TimeEntry } from '../models/index.js';
import { dayKey } from './helpers.js';

const RANK = { away: 0, idle: 1, active: 2 };
const COL = { active: 'activeMinutes', idle: 'idleMinutes', away: 'awayMinutes' };
const WORK_COL = { active: 'workActiveMinutes', idle: 'workIdleMinutes', away: 'workAwayMinutes' };

/** Record a discrete event. Never throws: tracking must not break the action being tracked. */
export async function logEvent(userId, type, detail = null, req = null, path = null) {
  try {
    await ActivityEvent.create({
      UserId: userId, type, detail: detail ? String(detail).slice(0, 300) : null, path: path ? String(path).slice(0, 200) : null,
      ip: req ? String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].slice(0, 64) : null,
      userAgent: req ? String(req.headers['user-agent'] || '').slice(0, 300) : null,
    });
  } catch (e) { console.error('activity log failed:', e.message); }
}

// userId -> { bucket, state, work, date } for the current minute, so several tabs / heartbeats count once per minute
const lastBucket = new Map();

/** Count one minute of activity for this user (called by the 30 s heartbeat). Returns the state counted. */
export async function recordHeartbeat(userId, state, path) {
  if (!RANK.hasOwnProperty(state)) state = 'away';
  const now = new Date();
  const bucket = Math.floor(now.getTime() / 60000);
  const date = dayKey(now);
  const prev = lastBucket.get(userId);

  const [row] = await ActivityDaily.findOrCreate({ where: { UserId: userId, date }, defaults: { firstSeen: now, pages: {} } });
  const cleanPath = path ? String(path).split('?')[0].slice(0, 200) : null;

  if (prev && prev.bucket === bucket && prev.date === date) {
    // Same minute already counted: only upgrade it (e.g. idle -> active from another tab)
    if (RANK[state] > RANK[prev.state]) {
      row[COL[prev.state]] = Math.max(0, row[COL[prev.state]] - 1); row[COL[state]] += 1;
      if (prev.work) { row[WORK_COL[prev.state]] = Math.max(0, row[WORK_COL[prev.state]] - 1); row[WORK_COL[state]] += 1; }
      if (state === 'active' && cleanPath) row.pages = { ...row.pages, [cleanPath]: (row.pages?.[cleanPath] || 0) + 1 };
      prev.state = state;
    }
  } else {
    const open = await TimeEntry.findOne({ where: { UserId: userId, clockOut: null }, attributes: ['id', 'breaks', 'clockIn'] });
    const work = !!open && !(open.breaks || []).some((b) => !b.end);
    row[COL[state]] += 1;
    if (work) row[WORK_COL[state]] += 1;
    if (state === 'active' && cleanPath) row.pages = { ...row.pages, [cleanPath]: (row.pages?.[cleanPath] || 0) + 1 };
    lastBucket.set(userId, { bucket, state, work, date });
  }
  // Live status = best state seen this minute, so a background tab ("away") doesn't hide an active one
  const best = lastBucket.get(userId).state;
  row.lastSeen = now; row.lastState = best; if (cleanPath && (state === best)) row.lastPath = cleanPath;
  if (!row.firstSeen) row.firstSeen = now;
  row.changed('pages', true);
  await row.save();
  return state;
}

/**
 * Close time entries that were left open (forgot to clock out). An entry is stale after MAX_SHIFT_HOURS.
 * It is closed at the user's last activity seen after clock-in (or clock-in + workday if never seen) and flagged.
 */
export async function closeStaleEntries() {
  const maxH = Number(process.env.MAX_SHIFT_HOURS) || 12;
  const workday = Number(process.env.WORKDAY_MINUTES) || 480;
  const stale = await TimeEntry.findAll({ where: { clockOut: null, clockIn: { [Op.lt]: new Date(Date.now() - maxH * 3600 * 1000) } } });
  for (const e of stale) {
    const seen = await ActivityDaily.max('lastSeen', { where: { UserId: e.UserId, lastSeen: { [Op.gt]: e.clockIn } } });
    const cap = new Date(new Date(e.clockIn).getTime() + maxH * 3600 * 1000);
    let end = seen ? new Date(seen) : new Date(new Date(e.clockIn).getTime() + workday * 60000);
    if (end > cap) end = cap;
    e.breaks = (e.breaks || []).map((b) => (b.end ? b : { ...b, end: new Date(Math.max(new Date(b.start), Math.min(end, cap))) }));
    e.clockOut = end; e.autoClosed = true;
    e.note = `Auto clock-out: no clock-out after ${maxH}h. Closed at last activity. Request a correction if this is wrong.`;
    await e.save();
    await logEvent(e.UserId, 'auto_clock_out', `Entry from ${e.date} closed automatically at ${end.toISOString()}`);
    console.log(`auto clock-out: user ${e.UserId}, entry ${e.id}`);
  }
  return stale.length;
}

/** Delete old activity events (heartbeat daily totals are kept). ACTIVITY_RETENTION_DAYS, default 180. */
export async function pruneActivity() {
  const days = Number(process.env.ACTIVITY_RETENTION_DAYS) || 180;
  return ActivityEvent.destroy({ where: { createdAt: { [Op.lt]: new Date(Date.now() - days * 86400000) } } });
}

/** Status shown to managers: active / idle / away when seen in the last 2 minutes, otherwise offline. */
export function liveState(row) {
  if (!row?.lastSeen || Date.now() - new Date(row.lastSeen).getTime() > 2 * 60000) return 'offline';
  return row.lastState || 'active';
}
