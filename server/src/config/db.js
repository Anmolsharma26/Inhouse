import mysql from 'mysql2/promise';
import { Sequelize } from 'sequelize';

const { DB_HOST = 'localhost', DB_PORT = 3306, DB_USER = 'root', DB_PASSWORD = '', DB_NAME = 'radiantmap' } = process.env;

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
  host: DB_HOST,
  port: Number(DB_PORT),
  dialect: 'mysql',
  logging: false,
  timezone: '+00:00', // store UTC
  define: { underscored: false },
});

// Create the database if it doesn't exist, then create/update tables.
export async function connectDB() {
  const conn = await mysql.createConnection({ host: DB_HOST, port: Number(DB_PORT), user: DB_USER, password: DB_PASSWORD });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();
  await import('../models/index.js'); // register models + associations
  await sequelize.sync({ alter: process.env.DB_SYNC === 'alter' });
  console.log('MySQL connected, tables ready');
}
