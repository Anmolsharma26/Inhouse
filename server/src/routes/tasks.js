import { Router } from 'express';
import { Op } from 'sequelize';
import { Task, User } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { httpError, pick, teamIds } from '../utils/helpers.js';

const router = Router();
router.use(requireAuth);

const include = [
  { model: User, as: 'assignee', attributes: ['id', 'name'] },
  { model: User, as: 'creator', attributes: ['id', 'name'] },
];

router.get('/', wrap(async (req, res) => {
  const where = {};
  where.assigneeId = req.user.role === 'employee' || req.query.scope === 'mine' ? req.user.id : await teamIds(req.user);
  if (req.query.status) where.status = req.query.status;
  if (req.query.overdue === 'true') Object.assign(where, { dueDate: { [Op.lt]: new Date() }, status: { [Op.ne]: 'completed' } });
  res.json(await Task.findAll({ where, include, order: [['dueDate', 'ASC'], ['createdAt', 'DESC']] }));
}));

router.post('/', requireRole('admin', 'manager'), wrap(async (req, res) => {
  const assignee = await User.findByPk(req.body.assigneeId);
  if (!assignee) throw httpError(400, 'Assignee not found');
  if (req.user.role === 'manager' && !(await teamIds(req.user)).includes(assignee.id)) throw httpError(403, 'Assignee is not in your team');
  const task = await Task.create({ ...pick(req.body, ['title', 'description', 'assigneeId', 'dueDate', 'priority']), createdBy: req.user.id });
  res.status(201).json(task);
}));

router.patch('/:id', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) throw httpError(404, 'Task not found');
  const isAssignee = task.assigneeId === req.user.id;
  const isManager = req.user.role !== 'employee';
  if (!isAssignee && !isManager) throw httpError(403, 'Forbidden');
  // assignees may only change status; managers/admins may edit everything
  const allowed = isManager ? ['title', 'description', 'assigneeId', 'dueDate', 'priority', 'status'] : ['status'];
  Object.assign(task, pick(req.body, allowed));
  task.completedAt = task.status === 'completed' ? task.completedAt || new Date() : null;
  await task.save();
  res.json(task);
}));

router.post('/:id/comments', wrap(async (req, res) => {
  const task = await Task.findByPk(req.params.id);
  if (!task) throw httpError(404, 'Task not found');
  if (task.assigneeId !== req.user.id && req.user.role === 'employee') throw httpError(403, 'Forbidden');
  task.comments = [...task.comments, { userId: req.user.id, name: req.user.name, text: req.body.text, createdAt: new Date() }];
  await task.save();
  res.status(201).json(task);
}));

export default router;
