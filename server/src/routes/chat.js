import { Router } from 'express';
import { Op, QueryTypes } from 'sequelize';
import { sequelize } from '../config/db.js';
import { Conversation, ConversationMember, Message, User } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { wrap } from '../middleware/error.js';
import { httpError, escapeLike } from '../utils/helpers.js';
import { messageInclude, isMember, toMessageJSON } from '../utils/chat.js';
import { createMessage, announceConversation } from '../socket.js';
import { upload, saveUpload } from '../utils/storage.js';

const router = Router();
router.use(requireAuth);

const PAGE = 50;

const requireMember = async (req) => {
  if (!(await isMember(req.params.id, req.user.id))) throw httpError(404, 'Conversation not found');
};

const memberInclude = { model: User, as: 'members', attributes: ['id', 'name', 'role', 'designation'], through: { attributes: [] } };

// Sidebar: my conversations + unread count + last message preview
router.get('/conversations', wrap(async (req, res) => {
  const uid = req.user.id;
  const mine = await ConversationMember.findAll({ where: { UserId: uid }, attributes: ['ConversationId'] });
  const ids = mine.map((m) => m.ConversationId);
  if (!ids.length) return res.json([]);
  const convs = await Conversation.findAll({ where: { id: ids }, order: [['lastMessageAt', 'DESC']], include: [memberInclude] });

  const counts = await sequelize.query(
    `SELECT m.ConversationId AS id, COUNT(*) AS n
       FROM Messages m JOIN ConversationMembers cm ON cm.ConversationId = m.ConversationId AND cm.UserId = :uid
      WHERE m.senderId <> :uid AND m.deletedAt IS NULL AND m.createdAt > cm.lastReadAt
      GROUP BY m.ConversationId`,
    { replacements: { uid }, type: QueryTypes.SELECT });
  const unread = Object.fromEntries(counts.map((c) => [c.id, Number(c.n)]));

  const last = await sequelize.query(
    `SELECT m.ConversationId AS id, m.text, m.attachments, m.deletedAt, m.createdAt, m.senderId, u.name AS senderName
       FROM Messages m JOIN Users u ON u.id = m.senderId
      WHERE m.id IN (SELECT MAX(id) FROM Messages WHERE ConversationId IN (:ids) GROUP BY ConversationId)`,
    { replacements: { ids }, type: QueryTypes.SELECT });
  const preview = Object.fromEntries(last.map((l) => {
    const att = typeof l.attachments === 'string' ? JSON.parse(l.attachments || '[]') : l.attachments || [];
    const text = l.deletedAt ? 'Message deleted' : l.text || (att.length ? `📎 ${att[0].name}` : '');
    return [l.id, { text, senderId: l.senderId, senderName: l.senderName, createdAt: l.createdAt }];
  }));

  res.json(convs.map((c) => ({ ...c.toJSON(), unread: unread[c.id] || 0, lastMessage: preview[c.id] || null })));
}));

router.post('/conversations', wrap(async (req, res) => {
  const { type, name, members = [], department } = req.body;
  if (!['direct', 'group', 'channel'].includes(type)) throw httpError(400, 'Invalid conversation type');
  if (type === 'channel' && req.user.role === 'employee') throw httpError(403, 'Only admins and managers can create channels');
  const ids = [...new Set([req.user.id, ...members.map(Number).filter(Boolean)])];
  const found = await User.count({ where: { id: ids, isActive: true } });
  if (found !== ids.length) throw httpError(400, 'One or more members do not exist or are inactive');

  if (type === 'direct') {
    if (ids.length !== 2) throw httpError(400, 'Direct chat needs exactly one other user');
    const existing = await Conversation.findAll({
      where: { type: 'direct' },
      include: [{ model: User, as: 'members', where: { id: ids }, attributes: ['id'], through: { attributes: [] } }],
    });
    const hit = existing.find((c) => c.members.length === 2);
    if (hit) return res.json(await Conversation.findByPk(hit.id, { include: [memberInclude] }));
  } else {
    if (!name?.trim()) throw httpError(400, 'Name is required for groups and channels');
    if (ids.length < 2) throw httpError(400, 'Add at least one other member');
  }

  const conv = await sequelize.transaction(async (t) => {
    const c = await Conversation.create({ type, name: name?.trim() || null, department, createdBy: req.user.id }, { transaction: t });
    await ConversationMember.bulkCreate(ids.map((UserId) => ({ ConversationId: c.id, UserId })), { transaction: t });
    return c;
  });
  await announceConversation(conv.id);
  res.status(201).json(await Conversation.findByPk(conv.id, { include: [memberInclude] }));
}));

// Add members to a group/channel (any current member of a group; admins/managers for channels)
router.post('/conversations/:id/members', wrap(async (req, res) => {
  await requireMember(req);
  const conv = await Conversation.findByPk(req.params.id);
  if (conv.type === 'direct') throw httpError(400, 'Cannot add people to a direct chat');
  if (conv.type === 'channel' && req.user.role === 'employee') throw httpError(403, 'Not allowed');
  const ids = [...new Set((req.body.members || []).map(Number).filter(Boolean))];
  const existing = new Set((await ConversationMember.findAll({ where: { ConversationId: conv.id } })).map((m) => m.UserId));
  const add = ids.filter((id) => !existing.has(id));
  if (add.length) await ConversationMember.bulkCreate(add.map((UserId) => ({ ConversationId: conv.id, UserId })));
  await announceConversation(conv.id);
  res.json(await Conversation.findByPk(conv.id, { include: [memberInclude] }));
}));

// History, newest page first. ?before=<messageId> loads the page of older messages.
router.get('/conversations/:id/messages', wrap(async (req, res) => {
  await requireMember(req);
  const where = { ConversationId: req.params.id };
  if (req.query.before) where.id = { [Op.lt]: Number(req.query.before) };
  const msgs = await Message.findAll({ where, order: [['id', 'DESC']], limit: PAGE + 1, include: messageInclude });
  const hasMore = msgs.length > PAGE;
  const members = await ConversationMember.findAll({ where: { ConversationId: req.params.id } });
  res.json({ messages: msgs.slice(0, PAGE).reverse().map((m) => toMessageJSON(m, members)), hasMore });
}));

// REST fallback for sending (used when the realtime connection is down). Still saved to MySQL and broadcast.
router.post('/conversations/:id/messages', wrap(async (req, res) => {
  const { text, attachments, replyTo } = req.body;
  try {
    res.status(201).json(await createMessage({ conversation: req.params.id, uid: req.user.id, text, attachments, replyTo }));
  } catch (e) { throw e.status ? httpError(e.status, e.message) : e; }
}));

router.post('/conversations/:id/read', wrap(async (req, res) => {
  await requireMember(req);
  await ConversationMember.update({ lastReadAt: new Date() }, { where: { ConversationId: req.params.id, UserId: req.user.id } });
  res.json({ ok: true });
}));

// Upload (local disk in dev, Cloudinary when CLOUDINARY_URL is set). Used by chat and task attachments.
router.post('/upload', upload.single('file'), wrap(async (req, res) => {
  res.json(await saveUpload(req.file));
}));

router.get('/search', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  const mine = await ConversationMember.findAll({ where: { UserId: req.user.id }, attributes: ['ConversationId'] });
  const msgs = await Message.findAll({
    where: { ConversationId: mine.map((m) => m.ConversationId), deletedAt: null, text: { [Op.like]: `%${escapeLike(q)}%` } },
    order: [['createdAt', 'DESC']], limit: 30, include: messageInclude,
  });
  res.json(msgs.map((m) => toMessageJSON(m)));
}));

export default router;
