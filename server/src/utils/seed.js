import { connectDB, sequelize } from '../config/db.js';
import { User, Conversation, ConversationMember } from '../models/index.js';

await connectDB();
await sequelize.sync({ force: true }); // wipes all tables – demo data only!

const admin = await User.create({ name: 'Admin User', email: 'admin@radiantmap.com', password: 'Admin@12345', role: 'admin', department: 'Management', designation: 'Administrator', joinedAt: new Date() });
const manager = await User.create({ name: 'Maya Manager', email: 'manager@radiantmap.com', password: 'Manager@12345', role: 'manager', department: 'Engineering', designation: 'Team Lead', canApproveTime: true, managerId: admin.id });
const ethan = await User.create({ name: 'Ethan Employee', email: 'ethan@radiantmap.com', password: 'Employee@12345', department: 'Engineering', designation: 'Developer', managerId: manager.id });
const priya = await User.create({ name: 'Priya Singh', email: 'priya@radiantmap.com', password: 'Employee@12345', department: 'Engineering', designation: 'Designer', managerId: manager.id });

const all = [admin, manager, ethan, priya];
for (const [name, department, members] of [['# general', null, all], ['# engineering', 'Engineering', all]]) {
  const c = await Conversation.create({ type: 'channel', name, department, createdBy: admin.id });
  await ConversationMember.bulkCreate(members.map((u) => ({ ConversationId: c.id, UserId: u.id })));
}

console.log('Seeded. Logins (change these!):\n  admin@radiantmap.com / Admin@12345\n  manager@radiantmap.com / Manager@12345\n  ethan@radiantmap.com / Employee@12345');
await sequelize.close();
