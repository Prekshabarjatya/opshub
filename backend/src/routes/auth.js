const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');
const config = require('../config');
const { authenticate, loadUser } = require('../middleware/auth');
const { httpError, wrap } = require('../utils');

const router = express.Router();

// Only FAILED logins count toward the limit, so a whole office signing in at 9am behind one
// IP address is never locked out, while password guessing is still throttled.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  department_id: u.department_id,
  department_name: u.department_name,
});

router.post(
  '/login',
  loginLimiter,
  wrap(async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!email || !password) throw httpError(400, 'Email and password are required');

    const { rows } = await pool.query(
      'SELECT id, password_hash, active FROM users WHERE email = $1',
      [email]
    );
    const row = rows[0];
    const ok = row ? await bcrypt.compare(password, row.password_hash) : false;
    if (!ok || !row.active) throw httpError(401, 'Invalid email or password');

    const token = jwt.sign({ sub: row.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    const user = await loadUser(row.id);
    res.json({ token, user: publicUser(user) });
  })
);

// One-time sign-in link: the token is single use and expires, so a forwarded link stops working after first use.
router.post(
  '/link',
  loginLimiter,
  wrap(async (req, res) => {
    const raw = String(req.body.token || '');
    if (!raw) throw httpError(400, 'Missing sign-in link');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const { rows } = await pool.query(
      `UPDATE login_links SET used_at = now()
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()
        RETURNING user_id`,
      [hash]
    );
    if (!rows[0]) throw httpError(401, 'This sign-in link has expired or was already used. Ask for a new one.');
    const user = await loadUser(rows[0].user_id);
    if (!user || !user.active) throw httpError(401, 'This account is not active');
    const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
    res.json({ token, user: publicUser(user) });
  })
);

router.get(
  '/me',
  authenticate,
  wrap(async (req, res) => {
    res.json({ user: publicUser(req.user) });
  })
);

router.post(
  '/change-password',
  authenticate,
  wrap(async (req, res) => {
    const current = String(req.body.current_password || '');
    const next = String(req.body.new_password || '');
    if (next.length < 8) throw httpError(400, 'New password must be at least 8 characters');

    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(current, rows[0].password_hash))) {
      throw httpError(400, 'Current password is incorrect');
    }
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
      await bcrypt.hash(next, 10),
      req.user.id,
    ]);
    res.json({ ok: true });
  })
);

module.exports = router;
