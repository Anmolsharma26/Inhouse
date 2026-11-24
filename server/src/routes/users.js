import { Router } from 'express';
import { Op } from 'sequelize';
import { User } from '../models/index.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { httpError, pick, escapeLike } from '../utils/helpers.js';

const router = Router();
router.use(requireAuth);

const FIELDS = ['name', 'email', 'role', 'department', 'designation', 'joinedAt', 'managerId', 'isActive', 'canApproveTime'];
const withManager = [{ model: User, as: 'manager', attributes: ['id', 'name'] }];

router.get('/', wrap(async (req, res) => {
  const where = req.query.q ? { name: { [Op.like]: `%${escapeLike(req.query.q)}%` } } : {};
  res.json(await User.findAll({ where, order: [['name', 'ASC']], include: withManager }));
}));

router.get('/:id', wrap(async (req, res) => {
  const u = await User.findByPk(req.params.id, { include: withManager });
  if (!u) throw httpError(404, 'User not found');
  res.json(u);
}));

router.post('/', requireRole('admin'), wrap(async (req, res) => {
  const user = await User.create({ ...pick(req.body, FIELDS), password: req.body.password });
  res.status(201).json(await User.findByPk(user.id));
}));

router.patch('/:id', requireRole('admin'), wrap(async (req, res) => {
  const user = await User.scope('withSecrets').findByPk(req.params.id);
  if (!user) throw httpError(404, 'User not found');
  Object.assign(user, pick(req.body, FIELDS));
  if (req.body.password) user.password = req.body.password;
  await user.save();
  res.json(await User.findByPk(user.id));
}));

export default router;
