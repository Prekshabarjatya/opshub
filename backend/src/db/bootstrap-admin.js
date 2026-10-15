/**
 * Runs on every start. If the database has NO Super Admin yet and ADMIN_NAME / ADMIN_EMAIL /
 * ADMIN_PASSWORD are set, creates the first one. Does nothing otherwise, and never blocks startup.
 * After the first login, delete ADMIN_PASSWORD from the host's environment variables.
 */
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function main() {
  const name = (process.env.ADMIN_NAME || '').trim();
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!name || !email || !password) return console.log('bootstrap-admin: ADMIN_* not set, skipping.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return console.log('bootstrap-admin: ADMIN_EMAIL invalid, skipping.');
  if (password.length < 10) return console.log('bootstrap-admin: ADMIN_PASSWORD must be 10+ characters, skipping.');
  const existing = await pool.query(`SELECT 1 FROM users WHERE role = 'super_admin' LIMIT 1`);
  if (existing.rows.length) return console.log('bootstrap-admin: a Super Admin already exists, skipping.');
  await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'super_admin')`,
    [name, email, await bcrypt.hash(password, 10)]
  );
  console.log(`bootstrap-admin: created Super Admin <${email}>.`);
}

main()
  .catch((err) => console.error('bootstrap-admin failed:', err.message))
  .finally(() => pool.end());
