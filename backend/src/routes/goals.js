const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { emitActivity } = require('../realtime');
const { httpError, wrap, toInt, isDate, todayISO, canAccessUser } = require('../utils');

const router = express.Router();
router.use(authenticate);

const STATUSES = ['todo', 'in_progress', 'completed', 'blocked', 'cancelled'];

// Resolve whose worklog is being touched and enforce RBAC.
async function resolveTarget(actor, userIdRaw) {
  const id = userIdRaw === undefined || userIdRaw === null || userIdRaw === '' ? actor.id : toInt(userIdRaw);
  if (!id || Number.isNaN(id)) throw httpError(400, 'Invalid user');
  const { rows } = await pool.query('SELECT id, department_id, active FROM users WHERE id = $1', [id]);
  const target = rows[0];
  if (!target) throw httpError(404, 'User not found');
  if (!canAccessUser(actor, target)) throw httpError(403, 'You cannot access this worklog');
  return target;
}

async function loadGoalWithOwner(goalId) {
  const { rows } = await pool.query(
    `SELECT g.*, u.department_id AS owner_department_id
       FROM goals g JOIN users u ON u.id = g.user_id
      WHERE g.id = $1`,
    [goalId]
  );
  return rows[0] || null;
}

router.get(
  '/',
  wrap(async (req, res) => {
    const date = req.query.date || todayISO();
    if (!isDate(date)) throw httpError(400, 'Invalid date');
    const target = await resolveTarget(req.user, req.query.user_id);
    const { rows } = await pool.query(
      `SELECT id, user_id, goal_date, title, status, created_at, updated_at, completed_at, blocked_at, blocked_reason
         FROM goals
        WHERE user_id = $1 AND goal_date = $2
        ORDER BY created_at, id`,
      [target.id, date]
    );
    res.json({ goals: rows });
  })
);

router.post(
  '/',
  wrap(async (req, res) => {
    const title = String(req.body.title || '').trim();
    const date = req.body.goal_date || todayISO();
    const status = req.body.status || 'todo';
    if (!title) throw httpError(400, 'Goal title is required');
    if (title.length > 300) throw httpError(400, 'Goal title is too long (max 300 characters)');
    if (!isDate(date)) throw httpError(400, 'Invalid date');
    if (!STATUSES.includes(status)) throw httpError(400, 'Invalid status');

    const target = await resolveTarget(req.user, req.body.user_id);
    const { rows } = await pool.query(
      `INSERT INTO goals (user_id, created_by, goal_date, title, status, completed_at, blocked_at)
       VALUES ($1, $2, $3, $4, $5::text,
               CASE WHEN $5::text = 'completed' THEN now() END,
               CASE WHEN $5::text = 'blocked' THEN now() END)
       RETURNING id, user_id, goal_date, title, status, created_at, updated_at, completed_at, blocked_at, blocked_reason`,
      [target.id, req.user.id, date, title, status]
    );
    emitActivity(target.department_id);
    res.status(201).json({ goal: rows[0] });
  })
);

// Update title and/or status. Timestamps are maintained automatically:
//  completed_at is set when a goal becomes Completed, blocked_at when it becomes Blocked.
router.patch(
  '/:id',
  wrap(async (req, res) => {
    const id = toInt(req.params.id);
    if (!id) throw httpError(400, 'Invalid goal id');
    const goal = await loadGoalWithOwner(id);
    if (!goal) throw httpError(404, 'Goal not found');
    if (!canAccessUser(req.user, { id: goal.user_id, department_id: goal.owner_department_id })) {
      throw httpError(403, 'You cannot modify this goal');
    }

    let title = null;
    let status = null;
    if (req.body.title !== undefined) {
      title = String(req.body.title).trim();
      if (!title) throw httpError(400, 'Goal title cannot be empty');
      if (title.length > 300) throw httpError(400, 'Goal title is too long (max 300 characters)');
    }
    if (req.body.status !== undefined) {
      status = req.body.status;
      if (!STATUSES.includes(status)) throw httpError(400, 'Invalid status');
    }
    let reason = null;
    if (req.body.blocked_reason !== undefined) {
      reason = String(req.body.blocked_reason || '').trim().slice(0, 300) || null;
    }
    if (title === null && status === null && reason === null) throw httpError(400, 'Nothing to update');

    const { rows } = await pool.query(
      `UPDATE goals SET
         title        = COALESCE($2::text, title),
         status       = COALESCE($3::text, status),
         completed_at = CASE WHEN $3::text IS NULL THEN completed_at
                             WHEN $3::text = 'completed' THEN COALESCE(completed_at, now())
                             ELSE NULL END,
         blocked_at   = CASE WHEN $3::text IS NULL THEN blocked_at
                             WHEN $3::text = 'blocked' THEN COALESCE(blocked_at, now())
                             ELSE NULL END,
         blocked_reason = CASE WHEN COALESCE($3::text, status) <> 'blocked' THEN NULL
                               ELSE COALESCE($4::text, blocked_reason) END,
         updated_at   = now()
       WHERE id = $1
       RETURNING id, user_id, goal_date, title, status, created_at, updated_at, completed_at, blocked_at, blocked_reason`,
      [id, title, status, reason]
    );
    emitActivity(goal.owner_department_id);
    res.json({ goal: rows[0] });
  })
);

// Bring the caller's unfinished goals from their last earlier worklog day into `goal_date`.
// The goals are moved (not copied) so nothing is double counted and blocked_at keeps its age.
router.post(
  '/carry-over',
  wrap(async (req, res) => {
    const date = req.body.goal_date || todayISO();
    if (!isDate(date)) throw httpError(400, 'Invalid date');
    const { rows } = await pool.query(
      `UPDATE goals SET goal_date = $2, updated_at = now()
        WHERE user_id = $1
          AND status IN ('todo', 'in_progress', 'blocked')
          AND goal_date = (SELECT MAX(goal_date) FROM goals
                            WHERE user_id = $1 AND goal_date < $2
                              AND status IN ('todo', 'in_progress', 'blocked'))
        RETURNING id, user_id, goal_date, title, status, created_at, updated_at, completed_at, blocked_at, blocked_reason`,
      [req.user.id, date]
    );
    emitActivity(req.user.department_id);
    res.json({ goals: rows });
  })
);

// Unfinished goals waiting on an earlier day (drives the "bring forward" prompt).
router.get(
  '/carry-over',
  wrap(async (req, res) => {
    const date = req.query.date || todayISO();
    if (!isDate(date)) throw httpError(400, 'Invalid date');
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count, MAX(goal_date) AS from_date FROM goals
        WHERE user_id = $1 AND status IN ('todo', 'in_progress', 'blocked')
          AND goal_date = (SELECT MAX(goal_date) FROM goals
                            WHERE user_id = $1 AND goal_date < $2
                              AND status IN ('todo', 'in_progress', 'blocked'))`,
      [req.user.id, date]
    );
    res.json(rows[0]);
  })
);

// Goals are an audit trail: once added they can be edited or marked Cancelled, never deleted.
router.delete('/:id', (req, res) => {
  res.status(405).set('Allow', 'GET, POST, PATCH').json({
    error: 'Goals cannot be deleted. Edit the goal or mark it Cancelled instead.',
  });
});

module.exports = router;
