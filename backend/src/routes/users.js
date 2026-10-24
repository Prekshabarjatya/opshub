const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError, wrap, toInt, canAccessUser } = require('../utils');

const router = express.Router();
router.use(authenticate);

const ROLES = ['super_admin', 'dept_head', 'employee'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SELECT_USER = `
  SELECT u.id, u.name, u.email, u.role, u.department_id, u.active, u.created_at,
         d.name AS department_name
    FROM users u
    LEFT JOIN departments d ON d.id = u.department_id`;

// Directory used for tagging / pickers. Admins also see emails and inactive users.
router.get(
  '/',
  wrap(async (req, res) => {
    const isAdmin = req.user.role === 'super_admin';
    const { rows } = await pool.query(
      `${SELECT_USER} ${isAdmin ? '' : 'WHERE u.active'} ORDER BY d.name NULLS FIRST, u.name`
    );
    const { role, department_id: myDept } = req.user;
    res.json({
      users: rows.map((u) => {
        if (isAdmin) return u;
        const { email, created_at, ...rest } = u; // eslint-disable-line no-unused-vars
        // A Dept Head can also see the email of the people in their own team.
        if (role === 'dept_head' && myDept && u.department_id === myDept) return { ...rest, email };
        return rest;
      }),
    });
  })
);

// Create a one-time sign-in link for a person (valid 7 days, single use).
// Super Admin: anyone except other Super Admins. Dept Head: people in their own department.
router.post(
  '/:id/login-link',
  requireRole('super_admin', 'dept_head'),
  wrap(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw httpError(400, 'Invalid user id');
    const { rows } = await pool.query('SELECT id, role, department_id, active FROM users WHERE id = $1', [id]);
    const target = rows[0];
    if (!target) throw httpError(404, 'User not found');
    if (!target.active) throw httpError(400, 'This account is deactivated');
    if (target.role === 'super_admin' && target.id !== req.user.id) throw httpError(403, 'Links cannot be made for another Super Admin');
    if (req.user.role === 'dept_head' && target.role !== 'employee') throw httpError(403, 'You can only make links for your team');
    if (!canAccessUser(req.user, target)) throw httpError(403, 'You can only make links for your team');
    const token = crypto.randomBytes(24).toString('base64url');
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows: link } = await pool.query(
      `INSERT INTO login_links (token_hash, user_id, created_by, expires_at)
       VALUES ($1, $2, $3, now() + interval '7 days') RETURNING expires_at`,
      [hash, id, req.user.id]
    );
    res.status(201).json({ token, expires_at: link[0].expires_at });
  })
);

// Super Admin: anyone, anywhere. Dept Head: employees in their OWN department only.
router.post(
  '/',
  requireRole('super_admin', 'dept_head'),
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    let role = req.body.role;
    let departmentId = toInt(req.body.department_id);

    if (req.user.role === 'dept_head') {
      if (!req.user.department_id) throw httpError(403, 'No department assigned to your account');
      if (role !== undefined && role !== 'employee') {
        throw httpError(403, 'Dept Heads can only add employees');
      }
      if (departmentId !== null && departmentId !== req.user.department_id) {
        throw httpError(403, 'You can only add people to your own department');
      }
      role = 'employee';
      departmentId = req.user.department_id;
    }

    if (!name) throw httpError(400, 'Name is required');
    if (!EMAIL_RE.test(email)) throw httpError(400, 'A valid email is required');
    if (password.length < 8) throw httpError(400, 'Password must be at least 8 characters');
    if (!ROLES.includes(role)) throw httpError(400, 'Invalid role');
    if (Number.isNaN(departmentId)) throw httpError(400, 'Invalid department');
    if (role !== 'super_admin' && !departmentId) {
      throw httpError(400, 'Department is required for this role');
    }

    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, department_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [name, email, await bcrypt.hash(password, 10), role, role === 'super_admin' ? null : departmentId]
    );
    const created = await pool.query(`${SELECT_USER} WHERE u.id = $1`, [rows[0].id]);
    res.status(201).json({ user: created.rows[0] });
  })
);

router.patch(
  '/:id',
  requireRole('super_admin'),
  wrap(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw httpError(400, 'Invalid user id');
    const { name, role, department_id: deptRaw, active, password } = req.body;

    const sets = [];
    const params = [];
    const add = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };

    if (name !== undefined) {
      const n = String(name).trim();
      if (!n) throw httpError(400, 'Name cannot be empty');
      add('name', n);
    }
    if (role !== undefined) {
      if (!ROLES.includes(role)) throw httpError(400, 'Invalid role');
      if (id === req.user.id && role !== req.user.role) {
        throw httpError(400, 'You cannot change your own role');
      }
      add('role', role);
    }
    if (deptRaw !== undefined) {
      const d = toInt(deptRaw);
      if (Number.isNaN(d)) throw httpError(400, 'Invalid department');
      add('department_id', d);
    }
    if (active !== undefined) {
      if (id === req.user.id && !active) throw httpError(400, 'You cannot deactivate yourself');
      add('active', !!active);
    }
    if (password !== undefined && password !== '') {
      if (String(password).length < 8) throw httpError(400, 'Password must be at least 8 characters');
      add('password_hash', await bcrypt.hash(String(password), 10));
    }
    if (!sets.length) throw httpError(400, 'Nothing to update');

    params.push(id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING id`,
      params
    );
    if (!result.rows[0]) throw httpError(404, 'User not found');
    const updated = await pool.query(`${SELECT_USER} WHERE u.id = $1`, [id]);
    res.json({ user: updated.rows[0] });
  })
);

router.delete(
  '/:id',
  requireRole('super_admin'),
  wrap(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw httpError(400, 'Invalid user id');
    if (id === req.user.id) throw httpError(400, 'You cannot delete yourself');
    const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (!result.rowCount) throw httpError(404, 'User not found');
    res.json({ ok: true });
  })
);

module.exports = router;
