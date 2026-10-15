const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { emitActivity } = require('../realtime');
const { httpError, wrap, toInt, isDate, todayISO, canAccessUser } = require('../utils');

const router = express.Router();
router.use(authenticate);

// Read an End-of-Day note. Own note by default; heads/admins may read their team's.
router.get(
  '/',
  wrap(async (req, res) => {
    const date = req.query.date || todayISO();
    if (!isDate(date)) throw httpError(400, 'Invalid date');
    const userId = req.query.user_id ? toInt(req.query.user_id) : req.user.id;
    if (!userId) throw httpError(400, 'Invalid user');

    const u = await pool.query('SELECT id, department_id FROM users WHERE id = $1', [userId]);
    if (!u.rows[0]) throw httpError(404, 'User not found');
    if (!canAccessUser(req.user, u.rows[0])) throw httpError(403, 'You cannot view this note');

    const { rows } = await pool.query(
      'SELECT id, user_id, note_date, note, created_at, updated_at FROM eod_notes WHERE user_id = $1 AND note_date = $2',
      [userId, date]
    );
    res.json({ note: rows[0] || null });
  })
);

// Submit (or update) your own End-of-Day note for a date.
router.put(
  '/',
  wrap(async (req, res) => {
    const date = req.body.note_date || todayISO();
    const note = String(req.body.note || '').trim();
    if (!isDate(date)) throw httpError(400, 'Invalid date');
    if (!note) throw httpError(400, 'The End-of-Day note cannot be empty');
    if (note.length > 5000) throw httpError(400, 'Note is too long (max 5000 characters)');

    const { rows } = await pool.query(
      `INSERT INTO eod_notes (user_id, note_date, note)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, note_date)
       DO UPDATE SET note = EXCLUDED.note, updated_at = now()
       RETURNING id, user_id, note_date, note, created_at, updated_at`,
      [req.user.id, date, note]
    );
    emitActivity(req.user.department_id);
    res.json({ note: rows[0] });
  })
);

module.exports = router;
