// Creates the first admin account on a fresh (empty) database, from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME.
// Needed on hosts without a shell (e.g. Render free plan). Does nothing once any admin exists.
import { User } from '../models/index.js';

export async function bootstrapAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME = 'Administrator' } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) return;
  if (await User.count({ where: { role: 'admin' } })) return;
  if (ADMIN_PASSWORD.length < 10) { console.error('ADMIN_PASSWORD must be at least 10 characters; first admin not created'); return; }
  await User.create({ name: ADMIN_NAME, email: ADMIN_EMAIL, password: ADMIN_PASSWORD, role: 'admin', canApproveTime: true, joinedAt: new Date() });
  console.log(`First admin account created: ${ADMIN_EMAIL}. You can remove ADMIN_PASSWORD from the environment now.`);
}
