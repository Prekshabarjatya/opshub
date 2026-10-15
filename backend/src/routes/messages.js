const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { emitToUser } = require('../realtime');
const { sendTagEmails } = require('../mail');
const { sendPushToUsers } = require('../push');
const { httpError, wrap, toInt, escapeLike } = require('../utils');

const router = express.Router();
router.use(authenticate);

const TARGET_LABEL_SQL = `
  CASE m.target_type
    WHEN 'all'  THEN 'Everyone'
    WHEN 'dept' THEN COALESCE('@' || td.name, '(deleted department)')
    ELSE COALESCE('@' || tu.name, '(deleted user)')
  END`;

/**
 * Send a message.
 *  - target_type 'all'  : Super Admin only (global broadcast)
 *  - target_type 'dept' : anyone, to any department (cross-department messaging needs no admin)
 *  - target_type 'user' : anyone, to any active user
 */
router.post(
  '/',
  wrap(async (req, res) => {
    const actor = req.user;
    const { target_type: type } = req.body;
    const body = String(req.body.body || '').trim();
    const targetId = toInt(req.body.target_id);

    if (!body) throw httpError(400, 'Message cannot be empty');
    if (body.length > 5000) throw httpError(400, 'Message is too long (max 5000 characters)');
    if (!['all', 'dept', 'user'].includes(type)) throw httpError(400, 'Invalid target type');
    if (type === 'all' && actor.role !== 'super_admin') {
      throw httpError(403, 'Only the Super Admin can send a global broadcast');
    }
    if (type !== 'all' && !targetId) throw httpError(400, 'Choose a department or person');

    let recipients = [];
    let targetLabel = 'Everyone';
    let deptId = null;
    let userId = null;

    if (type === 'all') {
      const r = await pool.query('SELECT id, email FROM users WHERE active AND id <> $1', [actor.id]);
      recipients = r.rows;
    } else if (type === 'dept') {
      const d = await pool.query('SELECT id, name FROM departments WHERE id = $1', [targetId]);
      if (!d.rows[0]) throw httpError(404, 'Department not found');
      deptId = d.rows[0].id;
      targetLabel = `@${d.rows[0].name}`;
      const r = await pool.query(
        'SELECT id, email FROM users WHERE active AND department_id = $1 AND id <> $2',
        [deptId, actor.id]
      );
      recipients = r.rows;
    } else {
      if (targetId === actor.id) throw httpError(400, 'You cannot message yourself');
      const u = await pool.query('SELECT id, name, email FROM users WHERE id = $1 AND active', [targetId]);
      if (!u.rows[0]) throw httpError(404, 'User not found');
      userId = u.rows[0].id;
      targetLabel = `@${u.rows[0].name}`;
      recipients = [u.rows[0]];
    }

    const inserted = await pool.query(
      `INSERT INTO messages (sender_id, target_type, target_dept_id, target_user_id, body)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [actor.id, type, deptId, userId, body]
    );
    const message = inserted.rows[0];

    if (recipients.length) {
      const notifs = await pool.query(
        `INSERT INTO notifications (user_id, message_id)
         SELECT unnest($1::int[]), $2
         RETURNING id, user_id`,
        [recipients.map((r) => r.id), message.id]
      );
      for (const n of notifs.rows) {
        emitToUser(n.user_id, 'notification', {
          id: n.id,
          message_id: message.id,
          sender_id: actor.id,
          sender_name: actor.name,
          target_label: targetLabel,
          body,
          created_at: message.created_at,
          is_read: false,
        });
      }
      sendTagEmails(recipients, { senderName: actor.name, targetLabel, body });
      // Phone / desktop push, even when the app is closed. Best effort, never blocks the response.
      sendPushToUsers(
        recipients.map((r) => r.id),
        { title: `${actor.name} → ${targetLabel}`, body, url: '/messages', tag: `msg-${message.id}` }
      ).catch((err) => console.error('Push error:', err.message));
    }

    res.status(201).json({ id: message.id, recipients: recipients.length });
  })
);

// Searchable history, limited to what the caller is allowed to see.
router.get(
  '/',
  wrap(async (req, res) => {
    const actor = req.user;
    const q = String(req.query.q || '').trim();
    const before = toInt(req.query.before);
    const limit = Math.min(Math.max(toInt(req.query.limit) || 50, 1), 100);

    const params = [];
    const where = [];
    const push = (v) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (actor.role !== 'super_admin') {
      const me = push(actor.id);
      let visible = `m.sender_id = ${me} OR m.target_type = 'all' OR (m.target_type = 'user' AND m.target_user_id = ${me})`;
      if (actor.department_id) {
        visible += ` OR (m.target_type = 'dept' AND m.target_dept_id = ${push(actor.department_id)})`;
      }
      where.push(`(${visible})`);
    }
    if (q) {
      const p = push(`%${escapeLike(q)}%`);
      where.push(`(m.body ILIKE ${p} OR su.name ILIKE ${p})`);
    }
    if (before) where.push(`m.id < ${push(before)}`);

    const { rows } = await pool.query(
      `SELECT m.id, m.body, m.created_at, m.target_type, m.sender_id,
              su.name AS sender_name, sd.name AS sender_department,
              ${TARGET_LABEL_SQL} AS target_label
         FROM messages m
         LEFT JOIN users su ON su.id = m.sender_id
         LEFT JOIN departments sd ON sd.id = su.department_id
         LEFT JOIN departments td ON td.id = m.target_dept_id
         LEFT JOIN users tu ON tu.id = m.target_user_id
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY m.id DESC
        LIMIT ${push(limit)}`,
      params
    );
    res.json({ messages: rows, has_more: rows.length === limit });
  })
);

module.exports = router;
