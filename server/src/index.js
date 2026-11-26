import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
import activityRoutes from './routes/activity.js';
import { closeStaleEntries, pruneActivity } from './utils/activity.js';
import { bootstrapAdmin } from './utils/bootstrap.js';

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.TZ) console.warn('WARNING: TZ is not set. "Today", late arrivals and daily totals use the server clock (UTC). Set TZ=Asia/Kolkata.');
if (isProd && (process.env.JWT_SECRET || '').length < 32) throw new Error('JWT_SECRET must be at least 32 characters in production');

const app = express();
// Behind Render / any reverse proxy: needed for correct client IPs (rate limit, login IP in activity log)
app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
      'connect-src': ["'self'", 'ws:', 'wss:'],
    },
  },
}));
app.use(cors({ origin: process.env.CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }));
// Local-disk uploads (development / when Cloudinary is not configured)
app.use('/uploads', express.static(path.resolve('uploads')));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/time', timeRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api', notFound);

// Serve the built React app (client/dist) from the same server, so the whole app is one URL.
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if ((isProd || process.env.SERVE_CLIENT === 'true') && fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html'))); // React Router handles the path
  console.log(`Serving web app from ${dist}`);
}
app.use(notFound);
app.use(errorHandler);

const server = http.createServer(app);
initSocket(server);

await connectDB();
await bootstrapAdmin();
// Background jobs: auto clock-out of forgotten entries (every 10 min) and activity log retention (daily)
const safely = (fn) => () => fn().catch((e) => console.error('job failed:', e.message));
setInterval(safely(closeStaleEntries), 10 * 60 * 1000);
setInterval(safely(pruneActivity), 24 * 60 * 60 * 1000);
safely(closeStaleEntries)(); safely(pruneActivity)();

server.listen(process.env.PORT || 5000, () => console.log(`API listening on :${process.env.PORT || 5000} (TZ=${process.env.TZ || 'system'})`));
