import { DataTypes as T } from 'sequelize';
import bcrypt from 'bcryptjs';
import { sequelize } from '../config/db.js';

// ---------- User ----------
export const User = sequelize.define('User', {
  name: { type: T.STRING(120), allowNull: false },
  email: { type: T.STRING(190), allowNull: false, unique: true, set(v) { this.setDataValue('email', String(v).trim().toLowerCase()); } },
  password: { type: T.STRING(100), allowNull: false },
  role: { type: T.ENUM('admin', 'manager', 'employee'), defaultValue: 'employee' },
  department: T.STRING(100),
  designation: T.STRING(100),
  joinedAt: T.DATEONLY,
  managerId: { type: T.INTEGER, allowNull: true },
  isActive: { type: T.BOOLEAN, defaultValue: true },
  canApproveTime: { type: T.BOOLEAN, defaultValue: false }, // "if permitted" for managers
  resetToken: T.STRING(100),
  resetExpires: T.DATE,
}, {
  // password & reset fields are hidden unless the "withSecrets" scope is used
  defaultScope: { attributes: { exclude: ['password', 'resetToken', 'resetExpires'] } },
  scopes: { withSecrets: { attributes: { include: ['password', 'resetToken', 'resetExpires'] } } },
  hooks: {
    async beforeSave(u) {
      if (u.changed('password')) {
        if (String(u.password).length < 8) throw Object.assign(new Error('Password must be at least 8 characters'), { status: 400 });
        u.password = await bcrypt.hash(u.password, 12);
      }
    },
  },
});
User.prototype.matchPassword = function (plain) { return bcrypt.compare(plain, this.password); };

// ---------- Chat ----------
export const Conversation = sequelize.define('Conversation', {
  type: { type: T.ENUM('direct', 'group', 'channel'), allowNull: false },
  name: T.STRING(120),
  department: T.STRING(100),
  createdBy: T.INTEGER,
  lastMessageAt: { type: T.DATE, defaultValue: T.NOW },
});

export const ConversationMember = sequelize.define('ConversationMember', {
  lastReadAt: { type: T.DATE, defaultValue: T.NOW }, // drives unread counts + read ticks
}, { timestamps: false });

export const Message = sequelize.define('Message', {
  text: { type: T.TEXT, allowNull: false, defaultValue: '' },
  attachments: { type: T.JSON, defaultValue: [] },   // [{url,name,mime,size}]
  reactions: { type: T.JSON, defaultValue: [] },     // [{userId,emoji}]
  replyToId: T.INTEGER,
  editedAt: T.DATE,
  deletedAt: T.DATE, // soft delete
}, { indexes: [{ fields: ['ConversationId', 'createdAt'] }] });

// ---------- Time ----------
export const TimeEntry = sequelize.define('TimeEntry', {
  date: { type: T.DATEONLY, allowNull: false }, // YYYY-MM-DD
  clockIn: { type: T.DATE, allowNull: false },
  clockOut: T.DATE,
  breaks: { type: T.JSON, defaultValue: [] },   // [{start,end}]
  taskId: T.INTEGER,
  source: { type: T.ENUM('clock', 'manual'), defaultValue: 'clock' },
  autoClosed: { type: T.BOOLEAN, defaultValue: false }, // closed by the system because the user forgot to clock out
  note: T.STRING(300),
}, { indexes: [{ fields: ['UserId', 'date'] }] });

TimeEntry.prototype.workedMinutes = function (now = new Date()) {
  const end = this.clockOut ? new Date(this.clockOut) : now;
  let ms = end - new Date(this.clockIn);
  for (const b of this.breaks || []) ms -= (b.end ? new Date(b.end) : end) - new Date(b.start);
  return Math.max(0, Math.round(ms / 60000));
};
TimeEntry.prototype.isOnBreak = function () {
  return !this.clockOut && (this.breaks || []).some((b) => !b.end);
};

export const ManualTimeRequest = sequelize.define('ManualTimeRequest', {
  date: { type: T.DATEONLY, allowNull: false },
  clockIn: { type: T.DATE, allowNull: false },
  clockOut: { type: T.DATE, allowNull: false },
  reason: { type: T.STRING(500), allowNull: false },
  status: { type: T.ENUM('pending', 'approved', 'rejected'), defaultValue: 'pending' },
  reviewNote: T.STRING(500),
});

// ---------- Tasks ----------
export const Task = sequelize.define('Task', {
  title: { type: T.STRING(200), allowNull: false },
  description: T.TEXT,
  dueDate: T.DATE,
  priority: { type: T.ENUM('low', 'medium', 'high'), defaultValue: 'medium' },
  status: { type: T.ENUM('pending', 'in_progress', 'completed'), defaultValue: 'pending' },
  comments: { type: T.JSON, defaultValue: [] }, // LEGACY – comments now live in the TaskComments table
  attachments: { type: T.JSON, defaultValue: [] }, // [{url,name,mime,size}]
  completedAt: T.DATE,
  // Extra task details (added to existing databases by the migration in config/db.js)
  project: T.STRING(120),
  startDate: T.DATEONLY,
  estimatedHours: T.DECIMAL(6, 2),
  tags: { type: T.JSON, defaultValue: [] },      // ['frontend', 'bug']
  checklist: { type: T.JSON, defaultValue: [] }, // [{id,text,done}]
});

// Comments + activity log on a task, one row per entry (kept permanently; deletes are soft)
export const TaskComment = sequelize.define('TaskComment', {
  kind: { type: T.ENUM('comment', 'activity'), defaultValue: 'comment' },
  text: { type: T.TEXT, allowNull: false },
  attachments: { type: T.JSON, defaultValue: [] },
  editedAt: T.DATE,
  deletedAt: T.DATE,
}, { indexes: [{ fields: ['TaskId', 'createdAt'] }] });

// ---------- Activity tracking (in-app only) ----------
// Discrete events: login, logout, clock_in, clock_out, break_start, break_end, page_view, idle_start, idle_end,
// task_created, task_updated, task_comment, message_sent, manual_request, auto_clock_out
export const ActivityEvent = sequelize.define('ActivityEvent', {
  type: { type: T.STRING(40), allowNull: false },
  detail: T.STRING(300),
  path: T.STRING(200),
  ip: T.STRING(64),
  userAgent: T.STRING(300),
}, { updatedAt: false, indexes: [{ fields: ['UserId', 'createdAt'] }, { fields: ['createdAt'] }] });

// One row per user per day, filled by 30-second heartbeats from the open app.
// active = using the app, idle = app in front but no input for IDLE_MINUTES, away = app open in a background tab.
// work* = the same, counted only while clocked in and not on break.
export const ActivityDaily = sequelize.define('ActivityDaily', {
  date: { type: T.DATEONLY, allowNull: false },
  activeMinutes: { type: T.INTEGER, defaultValue: 0 },
  idleMinutes: { type: T.INTEGER, defaultValue: 0 },
  awayMinutes: { type: T.INTEGER, defaultValue: 0 },
  workActiveMinutes: { type: T.INTEGER, defaultValue: 0 },
  workIdleMinutes: { type: T.INTEGER, defaultValue: 0 },
  workAwayMinutes: { type: T.INTEGER, defaultValue: 0 },
  firstSeen: T.DATE,
  lastSeen: T.DATE,
  lastState: T.STRING(10),
  lastPath: T.STRING(200),
  pages: { type: T.JSON, defaultValue: {} }, // { '/chat': 12, '/tasks': 30 } active minutes per page
}, { tableName: 'ActivityDaily', indexes: [{ unique: true, fields: ['UserId', 'date'] }] });

// ---------- Associations ----------
User.belongsTo(User, { as: 'manager', foreignKey: 'managerId' });
User.hasMany(User, { as: 'reports', foreignKey: 'managerId' });

Conversation.belongsToMany(User, { through: ConversationMember, as: 'members' });
User.belongsToMany(Conversation, { through: ConversationMember, as: 'conversations' });
Conversation.hasMany(ConversationMember);
ConversationMember.belongsTo(Conversation);
ConversationMember.belongsTo(User);

Message.belongsTo(Conversation);
Conversation.hasMany(Message);
Message.belongsTo(User, { as: 'sender', foreignKey: 'senderId' });
Message.belongsTo(Message, { as: 'replyTo', foreignKey: 'replyToId' });

ActivityEvent.belongsTo(User);
ActivityDaily.belongsTo(User);
TimeEntry.belongsTo(User);
User.hasMany(TimeEntry);
ManualTimeRequest.belongsTo(User);
ManualTimeRequest.belongsTo(User, { as: 'reviewer', foreignKey: 'reviewedBy' });

Task.belongsTo(User, { as: 'assignee', foreignKey: 'assigneeId' });
Task.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' });
User.hasMany(Task, { as: 'tasks', foreignKey: 'assigneeId' });
Task.hasMany(TaskComment, { as: 'commentList', onDelete: 'CASCADE' });
TaskComment.belongsTo(Task);
TaskComment.belongsTo(User, { as: 'author', foreignKey: 'authorId' });
