const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError, wrap, toInt } = require('../utils');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT d.id, d.name, d.created_at,
              COUNT(u.id) FILTER (WHERE u.active)::int AS member_count
         FROM departments d
         LEFT JOIN users u ON u.department_id = d.id
        GROUP BY d.id
        ORDER BY d.name`
    );
    res.json({ departments: rows });
  })
);

router.post(
  '/',
  requireRole('super_admin'),
  wrap(async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw httpError(400, 'Department name is required');
    if (name.length > 60) throw httpError(400, 'Department name is too long');
    const { rows } = await pool.query(
      'INSERT INTO departments (name) VALUES ($1) RETURNING id, name, created_at',
      [name]
    );
    res.status(201).json({ department: { ...rows[0], member_count: 0 } });
  })
);

router.patch(
  '/:id',
  requireRole('super_admin'),
  wrap(async (req, res) => {
    const id = toInt(req.params.id);
    const name = String(req.body.name || '').trim();
    if (!id) throw httpError(400, 'Invalid department id');
    if (!name) throw httpError(400, 'Department name is required');
    const { rows } = await pool.query(
      'UPDATE departments SET name = $1 WHERE id = $2 RETURNING id, name, created_at',
      [name, id]
    );
    if (!rows[0]) throw httpError(404, 'Department not found');
    res.json({ department: rows[0] });
  })
);

router.delete(
  '/:id',
  requireRole('super_admin'),
  wrap(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw httpError(400, 'Invalid department id');
    const members = await pool.query(
      'SELECT COUNT(*)::int AS n FROM users WHERE department_id = $1',
      [id]
    );
    if (members.rows[0].n > 0) {
      throw httpError(
        409,
        'This department still has members. Move or remove them before deleting it.'
      );
    }
    const result = await pool.query('DELETE FROM departments WHERE id = $1', [id]);
    if (!result.rowCount) throw httpError(404, 'Department not found');
    res.json({ ok: true });
  })
);

module.exports = router;
