import { Router } from 'express';
import crypto from 'crypto';
import { Op } from 'sequelize';
import { sequelize } from '../config/db.js';
import { Task, TaskComment, User } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { httpError, pick, teamIds } from '../utils/helpers.js';
import { getIO } from '../socket.js';
import { logEvent } from '../utils/activity.js';
import { cleanAttachments } from '../utils/storage.js';

const router = Router();
router.use(requireAuth);

const STATUS = { pending: 'Pending', in_progress: 'In Progress', completed: 'Completed' };
const userAttrs = ['id', 'name', 'designation'];
const include = [
  { model: User, as: 'assignee', attributes: userAttrs },
  { model: User, as: 'creator', attributes: userAttrs },
];
const commentCount = [sequelize.literal(
  "(SELECT COUNT(*) FROM TaskComments tc WHERE tc.TaskId = `Task`.`id` AND tc.kind = 'comment' AND tc.deletedAt IS NULL)"), 'commentCount'];

// ---------- permissions ----------
async function canManage(task, user) {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager') return false;
  return task.createdBy === user.id || (await teamIds(user)).includes(task.assigneeId);
}
async function canView(task, user) {
  if (task.assigneeId === user.id || task.createdBy === user.id) return true;
  return canManage(task, user);
}
async function loadTask(req, { manage = false } = {}) {
  const task = await Task.findByPk(req.params.id);
  if (!task || !(await canView(task, req.user))) throw httpError(404, 'Task not found');
  if (manage && !(await canManage(task, req.user))) throw httpError(403, 'Only the task owner or a manager can do this');
  return task;
}

// ---------- realtime: tell the assignee + creator (both sides of the task) ----------
function notify(task, event, payload) {
  const ids = [...new Set([task.assigneeId, task.createdBy].filter(Boolean))];
  getIO()?.to(ids.map((id) => `user:${id}`)).emit(event, payload);
}
const notifyChanged = (task) => notify(task, 'task:changed', { id: task.id });

// ---------- input cleaning ----------
const cleanTags = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(','))
  .map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 10).map((t) => t.slice(0, 30));
const cleanChecklist = (v) => (Array.isArray(v) ? v : []).slice(0, 50)
  .map((i) => ({ id: i.id || crypto.randomUUID(), text: String(i.text || '').trim().slice(0, 300), done: !!i.done }))
  .filter((i) => i.text);

function cleanBody(body) {
  const data = pick(body, ['title', 'description', 'assigneeId', 'dueDate', 'priority', 'status', 'project', 'startDate', 'estimatedHours']);
  if ('title' in data && !String(data.title || '').trim()) throw httpError(400, 'Title is required');
  if (data.title) data.title = String(data.title).trim().slice(0, 200);
  if (data.priority && !['low', 'medium', 'high'].includes(data.priority)) throw httpError(400, 'Invalid priority');
  if (data.status && !STATUS[data.status]) throw httpError(400, 'Invalid status');
  if (data.estimatedHours != null) {
    const h = Number(data.estimatedHours);
    if (!Number.isFinite(h) || h < 0 || h > 9999) throw httpError(400, 'Estimated hours must be between 0 and 9999');
    data.estimatedHours = h;
  }
  if (data.startDate && data.dueDate && new Date(data.startDate) > new Date(data.dueDate)) throw httpError(400, 'Start date is after the due date');
  if (body.tags !== undefined) data.tags = cleanTags(body.tags);
  if (body.checklist !== undefined) data.checklist = cleanChecklist(body.checklist);
  if (body.attachments !== undefined) data.attachments = cleanAttachments(body.attachments);
  return data;
}

const logActivity = (task, user, text) => TaskComment.create({ TaskId: task.id, authorId: user.id, kind: 'activity', text });
const fmtDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : 'none');

// ---------- routes ----------
router.get('/', wrap(async (req, res) => {
  const where = {};
  if (req.user.role === 'employee' || req.query.scope === 'mine') where.assigneeId = req.user.id;
  else where[Op.or] = [{ assigneeId: await teamIds(req.user) }, { createdBy: req.user.id }];
  if (req.query.status) where.status = req.query.status;
  if (req.query.priority) where.priority = req.query.priority;
  if (req.query.assigneeId) where.assigneeId = req.user.role === 'employee' ? req.user.id : Number(req.query.assigneeId);
  if (req.query.overdue === 'true') Object.assign(where, { dueDate: { [Op.lt]: new Date() }, status: { [Op.ne]: 'completed' } });
  if (req.query.q) {
    const q = `%${String(req.query.q).replace(/[\\%_]/g, '\\$&')}%`;
    where[Op.and] = [{ [Op.or]: [{ title: { [Op.like]: q } }, { description: { [Op.like]: q } }, { project: { [Op.like]: q } }] }];
  }
  res.json(await Task.findAll({
    where, include, attributes: { include: [commentCount], exclude: ['comments'] },
    order: [[sequelize.literal('`Task`.`dueDate` IS NULL'), 'ASC'], ['dueDate', 'ASC'], ['createdAt', 'DESC']],
  }));
}));

router.get('/:id', wrap(async (req, res) => {
  const task = await loadTask(req);
  const full = await Task.findByPk(task.id, { include, attributes: { exclude: ['comments'] } });
  const comments = await TaskComment.findAll({
    where: { TaskId: task.id }, order: [['createdAt', 'ASC'], ['id', 'ASC']],
    include: [{ model: User, as: 'author', attributes: userAttrs }],
  });
  res.json({ ...full.toJSON(), comments, canManage: await canManage(task, req.user) });
}));

router.post('/', requireRole('admin', 'manager'), wrap(async (req, res) => {
  const data = cleanBody({ status: 'pending', ...req.body });
  if (!data.title) throw httpError(400, 'Title is required');
  const assignee = await User.findByPk(data.assigneeId);
  if (!assignee?.isActive) throw httpError(400, 'Assignee not found');
  if (req.user.role === 'manager' && !(await teamIds(req.user)).includes(assignee.id)) throw httpError(403, 'Assignee is not in your team');
  const task = await Task.create({ ...data, createdBy: req.user.id, completedAt: data.status === 'completed' ? new Date() : null });
  await logActivity(task, req.user, `created this task and assigned it to ${assignee.name}`);
  logEvent(req.user.id, 'task_created', `#${task.id} ${task.title}`);
  notifyChanged(task);
  res.status(201).json(task);
}));

router.patch('/:id', wrap(async (req, res) => {
  const task = await loadTask(req);
  const manager = await canManage(task, req.user);
  if (!manager && task.assigneeId !== req.user.id) throw httpError(403, 'Forbidden');
  const data = cleanBody(req.body);

  // Assignees may change the status and tick checklist items; owners/managers may edit everything.
  let changes;
  if (manager) changes = data;
  else {
    changes = pick(data, ['status']);
    if (data.checklist) {
      const done = Object.fromEntries(data.checklist.map((i) => [i.id, i.done]));
      changes.checklist = (task.checklist || []).map((i) => (i.id in done ? { ...i, done: done[i.id] } : i));
    }
  }

  if (changes.assigneeId && Number(changes.assigneeId) !== task.assigneeId) {
    const assignee = await User.findByPk(changes.assigneeId);
    if (!assignee?.isActive) throw httpError(400, 'Assignee not found');
    if (req.user.role === 'manager' && !(await teamIds(req.user)).includes(assignee.id)) throw httpError(403, 'Assignee is not in your team');
    changes.assigneeId = assignee.id;
    changes._assigneeName = assignee.name;
  }

  // Activity log entries for the important changes, so both people can see what happened
  const log = [];
  if (changes.status && changes.status !== task.status) log.push(`changed status from ${STATUS[task.status]} to ${STATUS[changes.status]}`);
  if (changes._assigneeName) log.push(`reassigned the task to ${changes._assigneeName}`);
  if (changes.priority && changes.priority !== task.priority) log.push(`changed priority to ${changes.priority}`);
  if ('dueDate' in changes && fmtDate(changes.dueDate) !== fmtDate(task.dueDate)) log.push(`changed the due date to ${fmtDate(changes.dueDate)}`);
  if (changes.title && changes.title !== task.title) log.push(`renamed the task to "${changes.title}"`);
  if (changes.checklist) {
    const before = Object.fromEntries((task.checklist || []).map((i) => [i.id, i.done]));
    for (const i of changes.checklist) if (i.id in before && before[i.id] !== i.done) log.push(`${i.done ? 'completed' : 'reopened'} checklist item "${i.text}"`);
  }
  delete changes._assigneeName;

  const oldAssignee = task.assigneeId;
  Object.assign(task, changes);
  task.completedAt = task.status === 'completed' ? task.completedAt || new Date() : null;
  await task.save();
  for (const text of log) await logActivity(task, req.user, text);
  if (log.length) logEvent(req.user.id, 'task_updated', `#${task.id} ${task.title}: ${log.join('; ')}`);

  notifyChanged(task);
  if (oldAssignee !== task.assigneeId) getIO()?.to(`user:${oldAssignee}`).emit('task:changed', { id: task.id });
  res.json(task);
}));

router.delete('/:id', wrap(async (req, res) => {
  const task = await loadTask(req, { manage: true });
  notifyChanged(task);
  await sequelize.transaction(async (t) => {
    await TaskComment.destroy({ where: { TaskId: task.id }, transaction: t });
    await task.destroy({ transaction: t });
  });
  res.json({ ok: true });
}));

// ---------- comments: assignee, creator and managers of the task can all comment ----------
const loadComment = (c) => TaskComment.findByPk(c.id, { include: [{ model: User, as: 'author', attributes: userAttrs }] });

router.post('/:id/comments', wrap(async (req, res) => {
  const task = await loadTask(req);
  const text = String(req.body.text || '').trim();
  const attachments = cleanAttachments(req.body.attachments);
  if (!text && !attachments.length) throw httpError(400, 'Comment cannot be empty');
  if (text.length > 5000) throw httpError(400, 'Comment is too long (max 5000 characters)');
  const c = await TaskComment.create({ TaskId: task.id, authorId: req.user.id, text, attachments });
  task.changed('updatedAt', true); await task.save(); // bump "last updated"
  const full = await loadComment(c);
  notify(task, 'task:comment', { taskId: task.id, comment: full });
  logEvent(req.user.id, 'task_comment', `#${task.id} ${task.title}`);
  res.status(201).json(full);
}));

router.patch('/:id/comments/:cid', wrap(async (req, res) => {
  const task = await loadTask(req);
  const c = await TaskComment.findOne({ where: { id: req.params.cid, TaskId: task.id, kind: 'comment', deletedAt: null } });
  if (!c) throw httpError(404, 'Comment not found');
  if (c.authorId !== req.user.id) throw httpError(403, 'You can only edit your own comments');
  const text = String(req.body.text || '').trim();
  if (!text) throw httpError(400, 'Comment cannot be empty');
  await c.update({ text: text.slice(0, 5000), editedAt: new Date() });
  const full = await loadComment(c);
  notify(task, 'task:comment', { taskId: task.id, comment: full });
  res.json(full);
}));

// Soft delete: the row stays in MySQL
router.delete('/:id/comments/:cid', wrap(async (req, res) => {
  const task = await loadTask(req);
  const c = await TaskComment.findOne({ where: { id: req.params.cid, TaskId: task.id, kind: 'comment', deletedAt: null } });
  if (!c) throw httpError(404, 'Comment not found');
  if (c.authorId !== req.user.id && req.user.role !== 'admin') throw httpError(403, 'You can only delete your own comments');
  await c.update({ deletedAt: new Date(), text: '', attachments: [] });
  const full = await loadComment(c);
  notify(task, 'task:comment', { taskId: task.id, comment: full });
  res.json(full);
}));

export default router;
