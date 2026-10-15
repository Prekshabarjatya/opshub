const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { wrap, toInt, httpError } = require('../utils');

const router = express.Router();
router.use(authenticate);

router.get(
  '/',
  wrap(async (req, res) => {
    const items = await pool.query(
      `SELECT n.id, n.message_id, n.is_read, n.created_at,
              m.body, m.sender_id, su.name AS sender_name,
              CASE m.target_type
                WHEN 'all'  THEN 'Everyone'
                WHEN 'dept' THEN COALESCE('@' || td.name, '(deleted department)')
                ELSE COALESCE('@' || tu.name, '(deleted user)')
              END AS target_label
         FROM notifications n
         JOIN messages m ON m.id = n.message_id
         LEFT JOIN users su ON su.id = m.sender_id
         LEFT JOIN departments td ON td.id = m.target_dept_id
         LEFT JOIN users tu ON tu.id = m.target_user_id
        WHERE n.user_id = $1
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT 50`,
      [req.user.id]
    );
    const unread = await pool.query(
      'SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT is_read',
      [req.user.id]
    );
    res.json({ items: items.rows, unread: unread.rows[0].n });
  })
);

router.post(
  '/read-all',
  wrap(async (req, res) => {
    await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND NOT is_read', [
      req.user.id,
    ]);
    res.json({ ok: true });
  })
);

router.post(
  '/:id/read',
  wrap(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw httpError(400, 'Invalid notification id');
    await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [
      id,
      req.user.id,
    ]);
    res.json({ ok: true });
  })
);

module.exports = router;
