import mysql from 'mysql2/promise';
import { Sequelize } from 'sequelize';

const { DB_HOST = 'localhost', DB_PORT = 3306, DB_USER = 'root', DB_PASSWORD = '', DB_NAME = 'radiantmap', DB_SSL, DB_SSL_CA } = process.env;

// Hosted MySQL (TiDB Cloud, Aiven, …) requires TLS. DB_SSL=true turns it on; DB_SSL_CA = the provider's CA certificate
// (PEM text, needed for Aiven). Without DB_SSL_CA the system's trusted certificates are used (works for TiDB Cloud).
const ssl = DB_SSL === 'true'
  ? { minVersion: 'TLSv1.2', rejectUnauthorized: true, ...(DB_SSL_CA && { ca: DB_SSL_CA.replace(/\\n/g, '\n') }) }
  : undefined;

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: Number(DB_PORT),
  dialect: 'mysql',
  logging: false,
  timezone: '+00:00', // store UTC
  define: { underscored: false },
  dialectOptions: ssl ? { ssl } : {},
  pool: { max: 5, min: 0, idle: 10000 },
});

// Create the database if it doesn't exist, then create/update tables.
export async function connectDB() {
  const conn = await mysql.createConnection({ host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD, ssl });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } catch (e) {
    // Hosted databases often don't allow CREATE DATABASE; that's fine if DB_NAME already exists.
    console.warn(`Could not create database "${DB_NAME}" (${e.code}); assuming it already exists.`);
  } finally { await conn.end(); }
  await import('../models/index.js'); // register models + associations
  await sequelize.sync({ alter: process.env.DB_SYNC === 'alter' });
  await migrate();
  console.log('MySQL connected, tables ready');
}

// Small, idempotent, additive migrations for databases created by an older version. Never drops or rewrites data.
async function migrate() {
  const { DataTypes: T } = Sequelize;
  const qi = sequelize.getQueryInterface();
  const cols = await qi.describeTable('Tasks');
  const add = { project: T.STRING(120), startDate: T.DATEONLY, estimatedHours: T.DECIMAL(6, 2), tags: T.JSON, checklist: T.JSON };
  for (const [name, type] of Object.entries(add)) {
    if (!cols[name]) { await qi.addColumn('Tasks', name, { type, allowNull: true }); console.log(`migration: added Tasks.${name}`); }
  }
  const teCols = await qi.describeTable('TimeEntries');
  if (!teCols.autoClosed) { await qi.addColumn('TimeEntries', 'autoClosed', { type: T.BOOLEAN, allowNull: false, defaultValue: false }); console.log('migration: added TimeEntries.autoClosed'); }
  if (!teCols.note) { await qi.addColumn('TimeEntries', 'note', { type: T.STRING(300), allowNull: true }); console.log('migration: added TimeEntries.note'); }
  // Copy any comments stored in the old Tasks.comments JSON column into the TaskComments table (once).
  const { Task, TaskComment } = sequelize.models;
  if (!(await TaskComment.count())) {
    for (const task of await Task.findAll({ attributes: ['id', 'comments'] })) {
      const old = Array.isArray(task.comments) ? task.comments : [];
      if (!old.length) continue;
      await TaskComment.bulkCreate(old.map((c) => ({ TaskId: task.id, authorId: c.userId, text: c.text || '', createdAt: c.createdAt, updatedAt: c.createdAt })));
      console.log(`migration: moved ${old.length} comment(s) of task ${task.id} to TaskComments`);
    }
  }
}
