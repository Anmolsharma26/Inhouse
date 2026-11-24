# RadiantMap – In-house Chat & Time Tracker (Starter)

**React + Tailwind + Redux Toolkit** frontend · **Node.js + Express + Socket.IO** backend · **MySQL** database (via Sequelize).
No Docker needed.

## Requirements

- Node.js 20.6 or newer
- MySQL 8 (or MariaDB 10.5+) running locally

## Setup

1. **Install MySQL** and make sure it is running. (Windows: MySQL Installer · macOS: `brew install mysql` · Ubuntu: `sudo apt install mysql-server`)
2. *(Recommended)* create a dedicated database user. In the MySQL shell:
   ```sql
   CREATE USER 'radiant'@'localhost' IDENTIFIED BY 'choose_a_password';
   GRANT ALL PRIVILEGES ON radiantmap.* TO 'radiant'@'localhost';
   GRANT CREATE ON *.* TO 'radiant'@'localhost';  -- lets the app create the database itself
   ```
   (Or just use `root` for local development.)
3. **Configure the server**
   ```bash
   cd server
   cp .env.example .env      # Windows: copy .env.example .env
   ```
   Edit `.env`: set `DB_USER`, `DB_PASSWORD` and a long random `JWT_SECRET`.
4. **Install, seed, run**
   ```bash
   cd ..
   npm run install:all
   npm run seed          # creates tables + demo users and #general / #engineering channels
   npm run dev:server    # http://localhost:5000
   npm run dev:client    # http://localhost:5173  (second terminal)
   ```

The server creates the `radiantmap` database and all tables automatically on start.
`server/database/schema.sql` is provided if you would rather create the schema by hand.

Demo logins (from the seed – change before real use):

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@radiantmap.com | Admin@12345 |
| Manager | manager@radiantmap.com | Manager@12345 |
| Employee | ethan@radiantmap.com | Employee@12345 |

> `npm run seed` **wipes all tables**. Never run it against real data.

## What's implemented

| Proposal module | Status |
| --- | --- |
| User management (create, roles, activate/deactivate, directory) | Working. Edit-user screen is a TODO |
| Auth (JWT, bcrypt, forgot/reset password) | Working. Reset link is printed to the server console; **email sending is a TODO** |
| Chat: 1:1, channels, realtime, typing, presence, unread counts, read ticks, attachments | Working |
| Chat: groups, reactions, edit/delete, replies, search | Server + socket events done and tested; **UI not built yet** |
| Time tracking: clock in/out, breaks, daily totals, late + overtime flags, manual requests + approval | Working |
| Tasks: assign, priority, due date, status board, overdue, comments API | Working. Task detail/comment UI is a TODO |
| Admin dashboard, timesheet reports, Excel export | Working. **PDF export is a TODO** |

## Tested

The API and realtime layer were tested against a live MySQL-compatible database: 40 REST checks (login, role permissions,
clock in/out/breaks, manual-entry approval and overtime, tasks, reports, Excel export) and 16 Socket.IO checks
(delivery, typing, unread counts, read receipts, reactions, edit/delete permissions, search, presence). The React UI builds,
but the screens have not been clicked through in a browser yet.

## Layout

```
server/src
  config/db.js     MySQL connection; auto-creates DB + tables
  models/index.js  User, Conversation, ConversationMember, Message, TimeEntry, ManualTimeRequest, Task
  routes/          auth, users, chat, time, tasks, reports
  middleware/      JWT auth + requireRole (server-side RBAC), error handling
  socket.js        Socket.IO: messaging, presence, typing, read receipts
client/src
  pages/           Login, Dashboard, Chat, Timesheet, Tasks, Employees, Admin
  store/           Redux Toolkit (auth)
```

## Decisions to confirm with RadiantMap

- Workday length, late-arrival cut-off and overtime rule: `WORKDAY_MINUTES` / `LATE_AFTER` in `server/.env`.
- Whether managers may approve manual time entries: per-user `canApproveTime` flag.
- Attachments are stored in `server/uploads` in dev. Replace `upload` in `routes/chat.js` with S3/Cloudinary for production.

## Before production

- Strong `JWT_SECRET`, HTTPS, restrict CORS, remove seed users.
- Replace `sync()` with proper migrations (set `DB_SYNC=alter` only in dev to apply model changes).
- Serve attachments via signed URLs; define backup/retention for chat and timesheet data; add audit logs if required.
