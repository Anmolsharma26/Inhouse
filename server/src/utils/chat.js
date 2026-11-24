import { Message, User, ConversationMember } from '../models/index.js';

export const messageInclude = [
  { model: User, as: 'sender', attributes: ['id', 'name'] },
  { model: Message, as: 'replyTo', attributes: ['id', 'text', 'senderId'] },
];

export const isMember = (conversationId, userId) =>
  ConversationMember.findOne({ where: { ConversationId: conversationId, UserId: userId } });

// Message JSON + whether anyone else has read it (lastReadAt-based read receipts)
export function toMessageJSON(msg, memberRows = []) {
  const j = msg.toJSON();
  j.conversationId = j.ConversationId;
  j.readByOthers = memberRows.some((m) => m.UserId !== j.senderId && new Date(m.lastReadAt) >= new Date(j.createdAt));
  return j;
}

export async function loadMessage(id) {
  const msg = await Message.findByPk(id, { include: messageInclude });
  if (!msg) return null;
  const members = await ConversationMember.findAll({ where: { ConversationId: msg.ConversationId } });
  return toMessageJSON(msg, members);
}
