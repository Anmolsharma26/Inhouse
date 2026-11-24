import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { Conversation, ConversationMember, Message, User } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { httpError, escapeLike } from '../utils/helpers.js';
import { messageInclude, isMember, toMessageJSON } from '../utils/chat.js';

const router = Router();
router.use(requireAuth);

const UPLOAD_DIR = path.resolve('uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const ALLOWED = /^(image\/(png|jpe?g|gif|webp)|application\/(pdf|zip)|text\/plain|application\/vnd\.(openxmlformats|ms-excel).*)$/;
// Dev storage on local disk. Swap for S3/Cloudinary in production (keep the {url,name,mime,size} shape).
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_r, f, cb) => cb(null, `${Date.now()}-${f.originalname.replace(/[^\w.-]/g, '_')}`),
  }),
  limits: { fileSize: (Number(process.env.MAX_UPLOAD_MB) || 10) * 1024 * 1024 },
  fileFilter: (_r, f, cb) => cb(ALLOWED.test(f.mimetype) ? null : httpError(400, 'File type not allowed'), ALLOWED.test(f.mimetype)),
});

const requireMember = async (req) => {
  if (!(await isMember(req.params.id, req.user.id))) throw httpError(404, 'Conversation not found');
};

router.get('/conversations', wrap(async (req, res) => {
  const mine = await ConversationMember.findAll({ where: { UserId: req.user.id }, attributes: ['ConversationId'] });
  const convs = await Conversation.findAll({
    where: { id: mine.map((m) => m.ConversationId) },
    order: [['lastMessageAt', 'DESC']],
    include: [{ model: User, as: 'members', attributes: ['id', 'name', 'role'], through: { attributes: [] } }],
  });
  const counts = await sequelize.query(
    `SELECT m.ConversationId AS id, COUNT(*) AS n
       FROM Messages m JOIN ConversationMembers cm ON cm.ConversationId = m.ConversationId AND cm.UserId = :uid
      WHERE m.senderId <> :uid AND m.deletedAt IS NULL AND m.createdAt > cm.lastReadAt
      GROUP BY m.ConversationId`,
    { replacements: { uid: req.user.id }, type: QueryTypes.SELECT });
  const map = Object.fromEntries(counts.map((c) => [c.id, Number(c.n)]));
  res.json(convs.map((c) => ({ ...c.toJSON(), unread: map[c.id] || 0 })));
}));

router.post('/conversations', wrap(async (req, res) => {
  const { type, name, members = [], department } = req.body;
  const ids = [...new Set([req.user.id, ...members.map(Number)])];
  if (type === 'direct') {
    if (ids.length !== 2) throw httpError(400, 'Direct chat needs exactly one other user');
    const existing = await Conversation.findAll({
      where: { type: 'direct' },
      include: [{ model: User, as: 'members', where: { id: ids }, attributes: ['id'], through: { attributes: [] } }],
    });
    const hit = existing.find((c) => c.members.length === 2);
    if (hit) return res.json(hit);
  } else if (!name) throw httpError(400, 'Name is required for groups and channels');
  const conv = await Conversation.create({ type, name, department, createdBy: req.user.id });
  await ConversationMember.bulkCreate(ids.map((UserId) => ({ ConversationId: conv.id, UserId })));
  res.status(201).json(conv);
}));

router.get('/conversations/:id/messages', wrap(async (req, res) => {
  await requireMember(req);
  const where = { ConversationId: req.params.id };
  if (req.query.before) where.createdAt = { [Op.lt]: new Date(req.query.before) };
  const msgs = await Message.findAll({ where, order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 50, include: messageInclude });
  const members = await ConversationMember.findAll({ where: { ConversationId: req.params.id } });
  res.json(msgs.reverse().map((m) => toMessageJSON(m, members)));
}));

router.post('/conversations/:id/read', wrap(async (req, res) => {
  await requireMember(req);
  await ConversationMember.update({ lastReadAt: new Date() }, { where: { ConversationId: req.params.id, UserId: req.user.id } });
  res.json({ ok: true });
}));

router.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) throw httpError(400, 'No file');
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname, mime: req.file.mimetype, size: req.file.size });
});

router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const mine = await ConversationMember.findAll({ where: { UserId: req.user.id }, attributes: ['ConversationId'] });
  res.json(await Message.findAll({
    where: { ConversationId: mine.map((m) => m.ConversationId), deletedAt: null, text: { [Op.like]: `%${escapeLike(q)}%` } },
    order: [['createdAt', 'DESC']], limit: 30, include: messageInclude,
  }));
}));

export default router;
