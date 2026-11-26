# Deploying RadiantMap for free

| Part | Free service |
| --- | --- |
| App (API + live chat + web pages, one URL) | **Render** – free web service |
| MySQL database | **TiDB Cloud** (Starter / Serverless, MySQL-compatible) |
| Uploaded files | **Cloudinary** – free plan |
| Code | **GitHub** (keep the repository **private**) |

> Free-plan limits change; check each provider's current terms.
> Render's free service **sleeps after ~15 min without visitors**; the first visit afterwards takes ~1 minute to wake it.
> While anyone has the app open it stays awake.

---

## 1. Database – TiDB Cloud (≈10 min)

1. Sign up at **tidbcloud.com** → create a **Starter / Serverless** cluster. Pick region **Singapore (ap-southeast-1)** (same as Render below).
2. Open the cluster → **Connect** → choose "General" / "Node.js". Generate or set a password. Note down:
   - Host (e.g. `gateway01.ap-southeast-1.prod.aws.tidbcloud.com`)
   - Port (`4000`)
   - User (e.g. `xxxxxxxx.root`)
   - Password
3. Open **SQL Editor** and run: `CREATE DATABASE radiantmap;`
   Database name = `radiantmap`. (The app creates all tables itself on first start.)

## 2. File storage – Cloudinary (≈5 min)

1. Sign up at **cloudinary.com** (free plan).
2. Dashboard → **API Keys** → copy the **API environment variable**. It looks like
   `CLOUDINARY_URL=cloudinary://123456789:abcDEF...@your-cloud-name` – you need the part after `CLOUDINARY_URL=`.
3. Settings → **Security** → turn on **"Allow delivery of PDF and ZIP files"** (otherwise PDF/ZIP attachments won't open).

## 3. Code – GitHub

The project is already linked to `github.com/Anmolsharma26/Inhouse`.
1. Make sure that repository is **Private** (GitHub → repo → Settings → General → Danger zone → Change visibility).
2. Commit and push the latest code:
   ```bash
   git add -A
   git commit -m "Prepare for deployment"
   git push
   ```
   `server/.env` is in `.gitignore` and is **never** uploaded – keep it that way.

## 4. App – Render (≈10 min)

1. Sign up at **render.com** with your GitHub account.
2. **New + → Blueprint** → select the `Inhouse` repository. Render reads `render.yaml` and shows the settings to fill in:

   | Setting | Value |
   | --- | --- |
   | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` | from step 1 |
   | `DB_NAME` | `radiantmap` |
   | `CLOUDINARY_URL` | `cloudinary://…` from step 2 |
   | `CLIENT_ORIGIN` | `https://radiantmap.onrender.com` (your service URL – fix it after the first deploy if Render gives a different one) |
   | `ADMIN_EMAIL` / `ADMIN_NAME` | your real admin login |
   | `ADMIN_PASSWORD` | a strong password, 10+ characters |

   Everything else (`TZ=Asia/Kolkata`, `JWT_SECRET`, workday rules, …) is filled in automatically.
3. Click **Apply**. The first build takes a few minutes. In **Logs** you should see:
   `MySQL connected, tables ready` → `First admin account created` → `API listening`.
4. Open your `https://….onrender.com` URL and log in with the admin account.
5. Afterwards: Render → service → **Environment** → delete `ADMIN_PASSWORD` (it is only used once).

## 5. After it is live

- **Add employees** in the app (Directory) – the demo accounts from `npm run seed` are **not** created in production.
- **Own domain (optional, free):** Render → service → Settings → Custom Domains (e.g. `app.radiantmap.com`), then set `CLIENT_ORIGIN` to it.
- **Updates:** every `git push` to the main branch redeploys automatically.
- **Backups:** free databases give limited/no backup guarantees. Export regularly, e.g. from your PC:
  `mysqldump -h <host> -P 4000 -u <user> -p --ssl-mode=REQUIRED radiantmap > backup.sql`
- **Business rules** (`WORKDAY_MINUTES`, `LATE_AFTER`, `MAX_SHIFT_HOURS`, `ACTIVITY_RETENTION_DAYS`) can be changed in Render → Environment.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Log: `JWT_SECRET must be at least 32 characters` | Set a long random `JWT_SECRET` in Render → Environment |
| Log: `ECONNREFUSED` / `Access denied` / SSL errors | Check the DB_* values; `DB_SSL` must be `true` for TiDB Cloud |
| Times / "late" flags are 5½ hours off | `TZ` must be `Asia/Kolkata` |
| Attachments disappear after a while | `CLOUDINARY_URL` is missing, so files were stored on Render's temporary disk |
| PDF attachment shows an error | Cloudinary → Settings → Security → allow PDF and ZIP delivery |
| First page load takes ~1 minute | Normal on the free plan (service was asleep) |
