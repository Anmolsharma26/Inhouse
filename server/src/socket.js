import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { User, Conversation, ConversationMember, Message } from './models/index.js';
import { isMember, loadMessage } from './utils/chat.js';
import { logEvent } from './utils/activity.js';
import { cleanAttachments } from './utils/storage.js';

const online = new Map(); // userId -> Set(socketId)
let io;
export const getIO = () => io;

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Make sure every member's open sockets are in the conversation room (covers conversations created after they connected). */
export async function joinMembersToRoom(conversationId) {
  if (!io) return [];
  const members = await ConversationMember.findAll({ where: { ConversationId: conversationId }, attributes: ['UserId'] });
  const ids = members.map((m) => m.UserId);
  io.in(ids.map((id) => `user:${id}`)).socketsJoin(`conv:${conversationId}`);
  return ids;
}

/** Tell members a conversation was created / they were added, so it shows up in their sidebar right away. */
export async function announceConversation(conversationId) {
  const ids = await joinMembersToRoom(conversationId);
  io?.to(ids.map((id) => `user:${id}`)).emit('conversation:new', { id: Number(conversationId) });
}

/** Save a message to MySQL, then broadcast it. Used by both the socket event and the REST fallback. */
export async function createMessage({ conversation, uid, text, attachments, replyTo }) {
  if (!(await isMember(conversation, uid))) throw err('Not a member of this conversation', 403);
  const clean = String(text ?? '').trim();
  attachments = cleanAttachments(attachments);
  if (!clean && !attachments.length) throw err('Empty message');
  if (clean.length > 5000) throw err('Message is too long (max 5000 characters)');
  if (replyTo) {
    const parent = await Message.findByPk(replyTo);
    if (!parent || String(parent.ConversationId) !== String(conversation)) throw err('Reply target not found');
  }
  const msg = await Message.create({
    ConversationId: conversation, senderId: uid, text: clean,
    attachments, replyToId: replyTo || null,
  });
  const now = new Date();
  await Conversation.update({ lastMessageAt: now }, { where: { id: conversation } });
  await ConversationMember.update({ lastReadAt: now }, { where: { ConversationId: conversation, UserId: uid } });
  await joinMembersToRoom(conversation);
  const full = await loadMessage(msg.id);
  io?.to(`conv:${conversation}`).emit('message:new', full);
  logEvent(uid, 'message_sent', `conversation ${conversation}`); // content is never logged
  return full;
}

export function initSocket(httpServer) {
  io = new Server(httpServer, { cors: { origin: process.env.CLIENT_ORIGIN, credentials: true } });

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

    socket.join(`user:${uid}`);
    const mine = await ConversationMember.findAll({ where: { UserId: uid }, attributes: ['ConversationId'] });
    mine.forEach((c) => socket.join(`conv:${c.ConversationId}`));

    // Wrap handlers so a DB error never crashes the process and the client always gets an ack.
    const on = (event, fn) => socket.on(event, async (payload = {}, ack) => {
      try { const r = await fn(payload || {}); ack?.({ ok: true, ...r }); }
      catch (e) { if (!e.status) console.error(`socket ${event}:`, e); ack?.({ ok: false, error: e.status ? e.message : 'Server error' }); }
    });

    on('conversation:join', async (convId) => { if (await isMember(convId, uid)) socket.join(`conv:${convId}`); });

    on('message:send', async ({ conversation, text, attachments, replyTo }) => {
      const m = await createMessage({ conversation, uid, text, attachments, replyTo });
      return { id: m.id, message: m };
    });

    on('message:edit', async ({ id, text }) => {
      const m = await Message.findOne({ where: { id, senderId: uid, deletedAt: null } });
      if (!m) throw err('Message not found', 404);
      if (!text?.trim()) throw err('Message cannot be empty');
      await m.update({ text: text.trim(), editedAt: new Date() });
      io.to(`conv:${m.ConversationId}`).emit('message:updated', await loadMessage(m.id));
    });

    // Soft delete: the row stays in MySQL (deletedAt set) so history/audits are preserved.
    on('message:delete', async ({ id }) => {
      const m = await Message.findOne({ where: { id, senderId: uid, deletedAt: null } });
      if (!m) throw err('Message not found', 404);
      await m.update({ deletedAt: new Date(), text: '', attachments: [] });
      io.to(`conv:${m.ConversationId}`).emit('message:updated', await loadMessage(m.id));
    });

    on('message:react', async ({ id, emoji }) => {
      const m = await Message.findByPk(id);
      if (!m || m.deletedAt || !(await isMember(m.ConversationId, uid))) throw err('Message not found', 404);
      if (typeof emoji !== 'string' || !emoji || emoji.length > 16) throw err('Invalid reaction');
      const list = [...(m.reactions || [])];
      const i = list.findIndex((r) => r.userId === uid && r.emoji === emoji);
      i >= 0 ? list.splice(i, 1) : list.push({ userId: uid, emoji });
      await m.update({ reactions: list });
      io.to(`conv:${m.ConversationId}`).emit('message:updated', await loadMessage(m.id));
    });

    on('message:read', async ({ conversation }) => {
      if (!(await isMember(conversation, uid))) return;
      const at = new Date();
      await ConversationMember.update({ lastReadAt: at }, { where: { ConversationId: conversation, UserId: uid } });
      socket.to(`conv:${conversation}`).emit('message:read', { conversation, userId: uid, at });
    });

    socket.on('typing', ({ conversation, typing } = {}) =>
      socket.to(`conv:${conversation}`).emit('typing', { conversation, userId: uid, name: socket.user.name, typing }));

    socket.on('disconnect', () => {
      const set = online.get(uid);
      set?.delete(socket.id);
      if (!set?.size) { online.delete(uid); io.emit('presence:update', { userId: uid, online: false }); }
    });
  });

  return io;
}
