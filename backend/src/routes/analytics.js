const express = require('express');
const pool = require('../db/pool');
const { authenticate, requireRole } = require('../middleware/auth');
const { httpError, wrap, toInt, isDate, todayISO } = require('../utils');

const router = express.Router();
router.use(authenticate, requireRole('super_admin', 'dept_head'));

// Parse filters and apply role scoping: a Dept Head is always pinned to their own department.
function parseScope(req) {
  let to = req.query.to || todayISO();
  let from = req.query.from || to;
  if (!isDate(from) || !isDate(to)) throw httpError(400, 'Invalid date range');
  if (from > to) [from, to] = [to, from];
  if ((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 > 366) {
    throw httpError(400, 'Date range too large (max 366 days)');
  }

  let deptId = toInt(req.query.dept_id);
  const userId = toInt(req.query.user_id);
  if (Number.isNaN(deptId) || Number.isNaN(userId)) throw httpError(400, 'Invalid filter');

  if (req.user.role === 'dept_head') {
    if (!req.user.department_id) throw httpError(403, 'No department assigned to your account');
    deptId = req.user.department_id;
  }
  return { from, to, deptId, userId };
}

// Cancelled goals are reported separately and do NOT count as pending or lower the completion rate.
const COUNTS = `
  COUNT(g.id) FILTER (WHERE g.status <> 'cancelled')::int  AS total,
  COUNT(g.id) FILTER (WHERE g.status = 'completed')::int   AS completed,
  COUNT(g.id) FILTER (WHERE g.status = 'in_progress')::int AS in_progress,
  COUNT(g.id) FILTER (WHERE g.status = 'todo')::int        AS todo,
  COUNT(g.id) FILTER (WHERE g.status = 'blocked')::int     AS blocked,
  COUNT(g.id) FILTER (WHERE g.status = 'cancelled')::int   AS cancelled`;

const withPct = (r) => ({
  ...r,
  pending: r.total - r.completed,
  completion_pct: r.total ? Math.round((r.completed / r.total) * 100) : 0,
});

router.get(
  '/overview',
  wrap(async (req, res) => {
    const { from, to, deptId, userId } = parseScope(req);
    const params = [from, to, deptId, userId];

    const [departments, employees, blocked] = await Promise.all([
      pool.query(
        `SELECT d.id, d.name, ${COUNTS}
           FROM departments d
           LEFT JOIN users u ON u.department_id = d.id AND u.active AND ($4::int IS NULL OR u.id = $4)
           LEFT JOIN goals g ON g.user_id = u.id AND g.goal_date BETWEEN $1::date AND $2::date
          WHERE ($3::int IS NULL OR d.id = $3)
          GROUP BY d.id
          ORDER BY d.name`,
        params
      ),
      pool.query(
        `SELECT u.id, u.name, u.role, d.name AS department, ${COUNTS}
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
           LEFT JOIN goals g ON g.user_id = u.id AND g.goal_date BETWEEN $1::date AND $2::date
          WHERE u.active AND u.role <> 'super_admin'
            AND ($3::int IS NULL OR u.department_id = $3)
            AND ($4::int IS NULL OR u.id = $4)
          GROUP BY u.id, d.name
          ORDER BY d.name NULLS LAST, u.name`,
        params
      ),
      // "Blocked" is a current state, so it ignores the date range (dept / employee filters still apply).
      pool.query(
        `SELECT g.id, g.title, g.goal_date, g.blocked_at,
                u.id AS user_id, u.name AS user_name, d.name AS department,
                ROUND(EXTRACT(EPOCH FROM (now() - g.blocked_at)) / 3600)::int AS hours_blocked
           FROM goals g
           JOIN users u ON u.id = g.user_id
           LEFT JOIN departments d ON d.id = u.department_id
          WHERE g.status = 'blocked'
            AND g.blocked_at < now() - interval '24 hours'
            AND u.active
            AND ($1::int IS NULL OR u.department_id = $1)
            AND ($2::int IS NULL OR u.id = $2)
          ORDER BY g.blocked_at`,
        [deptId, userId]
      ),
    ]);

    const deptRows = departments.rows.map(withPct);
    const empRows = employees.rows.map(withPct);
    const sum = (k) => deptRows.reduce((a, r) => a + r[k], 0);
    const total = sum('total');
    const completed = sum('completed');

    res.json({
      range: { from, to },
      summary: {
        total,
        completed,
        pending: total - completed,
        blocked: sum('blocked'),
        cancelled: sum('cancelled'),
        completion_pct: total ? Math.round((completed / total) * 100) : 0,
        blocked_over_24h: blocked.rows.length,
      },
      departments: deptRows,
      employees: empRows,
      blocked_tasks: blocked.rows,
    });
  })
);

// Live feed of End-of-Day notes across the (scoped) organisation.
router.get(
  '/feed',
  wrap(async (req, res) => {
    const { from, to, deptId, userId } = parseScope(req);
    const { rows } = await pool.query(
      `SELECT e.id, e.note, e.note_date, e.updated_at,
              u.id AS user_id, u.name AS user_name, d.name AS department,
              (SELECT COUNT(*)::int FROM goals g
                WHERE g.user_id = e.user_id AND g.goal_date = e.note_date AND g.status <> 'cancelled') AS goals_total,
              (SELECT COUNT(*)::int FROM goals g
                WHERE g.user_id = e.user_id AND g.goal_date = e.note_date AND g.status = 'completed') AS goals_completed
         FROM eod_notes e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN departments d ON d.id = u.department_id
        WHERE e.note_date BETWEEN $1::date AND $2::date
          AND u.active
          AND ($3::int IS NULL OR u.department_id = $3)
          AND ($4::int IS NULL OR u.id = $4)
        ORDER BY e.updated_at DESC
        LIMIT 100`,
      [from, to, deptId, userId]
    );
    res.json({ items: rows });
  })
);

module.exports = router;
