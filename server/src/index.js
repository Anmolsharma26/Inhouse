import http from 'http';
import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { connectDB } from './config/db.js';
import { initSocket } from './socket.js';
import { notFound, errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import chatRoutes from './routes/chat.js';
import timeRoutes from './routes/time.js';
import taskRoutes from './routes/tasks.js';
import reportRoutes from './routes/reports.js';

const app = express();
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }));
// NOTE: dev-only static serving. In production serve attachments from S3/Cloudinary with signed URLs.
app.use('/uploads', express.static(path.resolve('uploads')));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/time', timeRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/reports', reportRoutes);
app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
initSocket(server);

await connectDB();
server.listen(process.env.PORT || 5000, () => console.log(`API listening on :${process.env.PORT || 5000}`));
