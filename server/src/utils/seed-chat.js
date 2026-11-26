// Adds sample chat history to MySQL WITHOUT deleting anything. Safe to run on a database with real data:
// it only adds messages to conversations that are still empty, so running it twice does not duplicate.
import { connectDB, sequelize } from '../config/db.js';
import { User, Conversation, ConversationMember, Message } from '../models/index.js';

await connectDB();

const byEmail = async (email) => User.findOne({ where: { email } });
const admin = await byEmail('admin@radiantmap.com');
const maya = await byEmail('manager@radiantmap.com');
const ethan = await byEmail('ethan@radiantmap.com');
const priya = await byEmail('priya@radiantmap.com');
if (!admin || !maya || !ethan || !priya) {
  console.error('Demo users not found. Run "npm run seed" once on an empty database first.');
  process.exit(1);
}

async function channel(name) {
  return Conversation.findOne({ where: { type: 'channel', name } });
}
async function direct(a, b) {
  const all = await Conversation.findAll({ where: { type: 'direct' }, include: [{ model: User, as: 'members', where: { id: [a.id, b.id] }, attributes: ['id'], through: { attributes: [] } }] });
  const hit = all.find((c) => c.members.length === 2);
  if (hit) return hit;
  const c = await Conversation.create({ type: 'direct', createdBy: a.id });
  await ConversationMember.bulkCreate([a, b].map((u) => ({ ConversationId: c.id, UserId: u.id })));
  return c;
}
async function group(name, owner, members) {
  let c = await Conversation.findOne({ where: { type: 'group', name } });
  if (!c) {
    c = await Conversation.create({ type: 'group', name, createdBy: owner.id });
    await ConversationMember.bulkCreate(members.map((u) => ({ ConversationId: c.id, UserId: u.id })));
  }
  return c;
}

// [sender, text, minutesAgo]
const H = 60, D = 24 * H;
const scripts = [
  [await channel('# general'), [
    [admin, 'Welcome to the RadiantMap team chat! Use #general for company-wide updates.', 3 * D],
    [maya, 'Thanks! Reminder: sprint planning is every Monday at 10:00.', 3 * D - 30],
    [ethan, 'Got it 👍', 3 * D - 25],
    [priya, 'Hi everyone, happy to be here!', 2 * D],
    [admin, 'Office will be closed on Friday for maintenance. Please work from home.', D + 2 * H],
    [maya, 'Please remember to clock in when you start your day.', 3 * H],
  ]],
  [await channel('# engineering'), [
    [maya, 'Deploy for v0.3 is scheduled for Thursday evening.', 2 * D + 4 * H],
    [ethan, 'The login rate-limit fix is merged and ready for QA.', 2 * D + 3 * H],
    [priya, 'New dashboard mockups are uploaded to the design folder.', D + 5 * H],
    [maya, 'Great work both. Ethan, can you review Priya’s designs today?', D + 4 * H],
    [ethan, 'Sure, will do after lunch.', D + 4 * H - 10],
  ]],
  [await direct(maya, ethan), [
    [maya, 'Hey Ethan, how is the timesheet export going?', 5 * H],
    [ethan, 'Almost done. Excel works, PDF is still a TODO.', 5 * H - 4],
    [maya, 'Perfect, let’s ship Excel first.', 5 * H - 2],
  ]],
  [await direct(admin, priya), [
    [admin, 'Hi Priya, your account is all set up. Let me know if anything is missing.', 2 * D + H],
    [priya, 'Thank you! Everything looks good.', 2 * D + 50],
  ]],
  [await group('Design review', maya, [maya, ethan, priya]), [
    [maya, 'Created this group for design feedback.', 6 * H],
    [priya, 'I’ll post the chat screen ideas here.', 6 * H - 15],
    [ethan, 'Looking forward to it.', 6 * H - 12],
  ]],
];

let added = 0;
for (const [conv, lines] of scripts) {
  if (!conv) continue;
  if (await Message.count({ where: { ConversationId: conv.id } })) { console.log(`skip  conversation ${conv.id} (${conv.name || 'direct'}) – already has messages`); continue; }
  let lastAt;
  for (const [sender, text, ago] of lines) {
    lastAt = new Date(Date.now() - ago * 60000);
    await Message.create({ ConversationId: conv.id, senderId: sender.id, text, createdAt: lastAt, updatedAt: lastAt });
    added++;
  }
  await conv.update({ lastMessageAt: lastAt });
  console.log(`added ${lines.length} messages to conversation ${conv.id} (${conv.name || 'direct'})`);
}
console.log(`Done. ${added} sample messages added; nothing was deleted.`);
await sequelize.close();
