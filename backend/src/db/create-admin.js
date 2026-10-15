/**
 * Create the first Super Admin on a fresh (production) database. Safe to run: it never wipes data
 * and refuses to overwrite an existing user.
 *
 *   npm run create-admin -- "Dharmendra" dharmendra@company.com "a-long-password"
 * or with env vars: ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD
 */
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const init = require('./init');

const [argName, argEmail, argPassword] = process.argv.slice(2);
const name = (argName || process.env.ADMIN_NAME || '').trim();
const email = (argEmail || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = argPassword || process.env.ADMIN_PASSWORD || '';

async function main() {
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Usage: npm run create-admin -- "Full Name" admin@company.com "password"');
  }
  if (password.length < 10) throw new Error('Password must be at least 10 characters.');

  await init(); // make sure tables exist
  const exists = await pool.query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rows.length) throw new Error(`A user with ${email} already exists. Nothing changed.`);

  await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'super_admin')`,
    [name, email, await bcrypt.hash(password, 10)]
  );
  console.log(`Super Admin created: ${name} <${email}>`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
