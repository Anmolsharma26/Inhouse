import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User, Conversation, ConversationMember, Message } from './models/index.js';
import { isMember, loadMessage } from './utils/chat.js';

const online = new Map(); // userId -> Set(socketId)

export function initSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN, credentials: true } });

  io.use(async (socket, next) => {
    try {
      const { id } = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
      const user = await User.findByPk(id);
      if (!user?.isActive) throw new Error('inactive');
      socket.user = user;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const uid = socket.user.id;
    if (!online.has(uid)) online.set(uid, new Set());
    online.get(uid).add(socket.id);
    io.emit('presence:update', { userId: uid, online: true });
    socket.emit('presence:list', [...online.keys()]);

    const mine = await ConversationMember.findAll({ where: { UserId: uid }, attributes: ['ConversationId'] });
    mine.forEach((c) => socket.join(`conv:${c.ConversationId}`));

    socket.on('conversation:join', async (convId) => { if (await isMember(convId, uid)) socket.join(`conv:${convId}`); });

    socket.on('message:send', async ({ conversation, text, attachments, replyTo }, ack) => {
      try {
        if (!(await isMember(conversation, uid))) throw new Error('Not a member');
        if (!text?.trim() && !attachments?.length) throw new Error('Empty message');
        const msg = await Message.create({ ConversationId: conversation, senderId: uid, text: text?.trim() || '', attachments: attachments || [], replyToId: replyTo || null });
        await Conversation.update({ lastMessageAt: new Date() }, { where: { id: conversation } });
        await ConversationMember.update({ lastReadAt: new Date() }, { where: { ConversationId: conversation, UserId: uid } });
        io.to(`conv:${conversation}`).emit('message:new', await loadMessage(msg.id));
        ack?.({ ok: true, id: msg.id });
      } catch (e) { ack?.({ ok: false, error: e.message }); }
    });

    socket.on('message:edit', async ({ id, text }) => {
      const m = await Message.findOne({ where: { id, senderId: uid, deletedAt: null } });
      if (!m || !text?.trim()) return;
      await m.update({ text: text.trim(), editedAt: new Date() });
      io.to(`conv:${m.ConversationId}`).emit('message:updated', await loadMessage(m.id));
    });

    socket.on('message:delete', async ({ id }) => {
      const m = await Message.findOne({ where: { id, senderId: uid } });
      if (!m) return;
      await m.update({ deletedAt: new Date(), text: '', attachments: [] });
      io.to(`conv:${m.ConversationId}`).emit('message:updated', await loadMessage(m.id));
    });

    socket.on('message:react', async ({ id, emoji }) => {
      const m = await Message.findByPk(id);
      if (!m || !(await isMember(m.ConversationId, uid))) return;
      const list = [...(m.reactions || [])];
      const i = list.findIndex((r) => r.userId === uid && r.emoji === emoji);
      i >= 0 ? list.splice(i, 1) : list.push({ userId: uid, emoji });
      await m.update({ reactions: list });
      io.to(`conv:${m.ConversationId}`).emit('message:updated', await loadMessage(m.id));
    });

    socket.on('message:read', async ({ conversation }) => {
      if (!(await isMember(conversation, uid))) return;
      const at = new Date();
      await ConversationMember.update({ lastReadAt: at }, { where: { ConversationId: conversation, UserId: uid } });
      socket.to(`conv:${conversation}`).emit('message:read', { conversation, userId: uid, at });
    });

    socket.on('typing', ({ conversation, typing }) =>
      socket.to(`conv:${conversation}`).emit('typing', { conversation, userId: uid, name: socket.user.name, typing }));

    socket.on('disconnect', () => {
      const set = online.get(uid);
      set?.delete(socket.id);
      if (!set?.size) { online.delete(uid); io.emit('presence:update', { userId: uid, online: false }); }
    });
  });

  return io;
}
