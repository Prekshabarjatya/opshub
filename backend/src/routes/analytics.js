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

    const [departments, employees, blocked, tasks] = await Promise.all([
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
        `SELECT g.id, g.title, g.goal_date, g.blocked_at, g.blocked_reason,
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
      // Every task entered in the range (cancelled included, shown struck through), grouped per employee client-side.
      pool.query(
        `SELECT g.id, g.user_id, g.title, g.status, g.goal_date, g.created_at, g.completed_at
           FROM goals g
           JOIN users u ON u.id = g.user_id
          WHERE g.goal_date BETWEEN $1::date AND $2::date
            AND u.active AND u.role <> 'super_admin'
            AND ($3::int IS NULL OR u.department_id = $3)
            AND ($4::int IS NULL OR u.id = $4)
          ORDER BY g.goal_date DESC, g.created_at DESC
          LIMIT 3000`,
        params
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
      tasks: tasks.rows,
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

const shiftDate = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const pct = (done, total) => (total ? Math.round((done / total) * 100) : null);

// "What needs my attention today": plain-language insights, who is silent, why work is stuck, and the weekly trend.
// `date` is the viewer's local calendar day (the server runs in UTC).
router.get(
  '/today',
  wrap(async (req, res) => {
    const date = req.query.date || todayISO();
    if (!isDate(date)) throw httpError(400, 'Invalid date');
    let deptId = toInt(req.query.dept_id);
    if (Number.isNaN(deptId)) throw httpError(400, 'Invalid filter');
    if (req.user.role === 'dept_head') {
      if (!req.user.department_id) throw httpError(403, 'No department assigned to your account');
      deptId = req.user.department_id;
    }
    const weekStart = shiftDate(date, -6);
    const prevStart = shiftDate(date, -13);
    const prevEnd = shiftDate(date, -7);

    const [people, blocked, trend] = await Promise.all([
      pool.query(
        `SELECT u.id, u.name, d.name AS department,
                COUNT(g.id) FILTER (WHERE g.goal_date = $1 AND g.status <> 'cancelled')::int AS goals_today,
                COUNT(g.id) FILTER (WHERE g.goal_date = $1 AND g.status = 'completed')::int AS done_today,
                EXISTS (SELECT 1 FROM eod_notes e WHERE e.user_id = u.id AND e.note_date = $1) AS eod_today,
                MAX(g.updated_at) AS last_update
           FROM users u
           LEFT JOIN departments d ON d.id = u.department_id
           LEFT JOIN goals g ON g.user_id = u.id
          WHERE u.active AND u.role <> 'super_admin' AND ($2::int IS NULL OR u.department_id = $2)
          GROUP BY u.id, d.name
          ORDER BY u.name`,
        [date, deptId]
      ),
      pool.query(
        `SELECT g.id, g.title, g.blocked_reason, u.id AS user_id, u.name AS user_name, d.name AS department,
                GREATEST(0, ROUND(EXTRACT(EPOCH FROM (now() - g.blocked_at)) / 3600))::int AS hours_blocked
           FROM goals g
           JOIN users u ON u.id = g.user_id
           LEFT JOIN departments d ON d.id = u.department_id
          WHERE g.status = 'blocked' AND u.active AND ($1::int IS NULL OR u.department_id = $1)
          ORDER BY g.blocked_at`,
        [deptId]
      ),
      pool.query(
        `SELECT d.id, d.name,
                COUNT(g.id) FILTER (WHERE g.goal_date >= $1 AND g.status <> 'cancelled')::int AS week_total,
                COUNT(g.id) FILTER (WHERE g.goal_date >= $1 AND g.status = 'completed')::int AS week_done,
                COUNT(g.id) FILTER (WHERE g.goal_date <= $3 AND g.status <> 'cancelled')::int AS prev_total,
                COUNT(g.id) FILTER (WHERE g.goal_date <= $3 AND g.status = 'completed')::int AS prev_done
           FROM departments d
           LEFT JOIN users u ON u.department_id = d.id AND u.active
           LEFT JOIN goals g ON g.user_id = u.id AND g.goal_date BETWEEN $2 AND $4
          WHERE ($5::int IS NULL OR d.id = $5)
          GROUP BY d.id ORDER BY d.name`,
        [weekStart, prevStart, prevEnd, date, deptId]
      ),
    ]);

    const ppl = people.rows;
    const noPlan = ppl.filter((p) => p.goals_today === 0);
    const noEod = ppl.filter((p) => !p.eod_today);
    const silentCutoff = Date.now() - 48 * 3600000;
    const silent = ppl.filter((p) => !p.last_update || new Date(p.last_update).getTime() < silentCutoff);

    // Group stuck work by reason so the owner fixes causes, not tasks.
    const groups = new Map();
    for (const b of blocked.rows) {
      const key = b.blocked_reason || 'No reason given';
      if (!groups.has(key)) groups.set(key, { reason: key, items: [], people: new Set(), oldest_hours: 0 });
      const g = groups.get(key);
      g.items.push(b);
      g.people.add(b.user_name);
      g.oldest_hours = Math.max(g.oldest_hours, b.hours_blocked);
    }
    const blockerGroups = [...groups.values()]
      .map((g) => ({ ...g, people: [...g.people], count: g.items.length }))
      .sort((a, b) => b.count - a.count || b.oldest_hours - a.oldest_hours);

    const perPerson = {};
    for (const b of blocked.rows) perPerson[b.user_name] = (perPerson[b.user_name] || 0) + 1;
    const stuckPeople = Object.entries(perPerson).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);

    const depts = trend.rows.map((d) => {
      const now = pct(d.week_done, d.week_total);
      const before = pct(d.prev_done, d.prev_total);
      return { ...d, week_pct: now, prev_pct: before, change: now !== null && before !== null ? now - before : null };
    });
    const sumK = (k) => depts.reduce((a, d) => a + d[k], 0);
    const weekPct = pct(sumK('week_done'), sumK('week_total'));
    const prevPct = pct(sumK('prev_done'), sumK('prev_total'));

    const goalsToday = ppl.reduce((a, p) => a + p.goals_today, 0);
    const doneToday = ppl.reduce((a, p) => a + p.done_today, 0);

    // Plain-language insights, most urgent first.
    const insights = [];
    const names = (list, n = 3) => list.slice(0, n).map((p) => p.name || p).join(', ') + (list.length > n ? ` +${list.length - n} more` : '');
    if (blockerGroups.length && blockerGroups[0].count >= 2) {
      const g = blockerGroups[0];
      insights.push({ tone: 'bad', text: `${g.count} tasks are stuck on "${g.reason}" (oldest ${Math.round(g.oldest_hours / 24)}d). Fixing this one cause unblocks ${names(g.people)}.` });
    }
    for (const [name, n] of stuckPeople.slice(0, 2)) {
      insights.push({ tone: 'bad', text: `${name} has ${n} blocked tasks. A quick call will likely clear more than tagging each task.` });
    }
    const falling = depts.filter((d) => d.change !== null && d.change <= -10).sort((a, b) => a.change - b.change);
    for (const d of falling.slice(0, 2)) {
      insights.push({ tone: 'warn', text: `${d.name} completion fell from ${d.prev_pct}% to ${d.week_pct}% this week.` });
    }
    if (noPlan.length) insights.push({ tone: 'warn', text: `${noPlan.length} ${noPlan.length === 1 ? 'person has' : 'people have'} not planned today: ${names(noPlan)}.` });
    if (silent.length) insights.push({ tone: 'warn', text: `No updates for 2+ days from ${names(silent)}.` });
    const rising = depts.filter((d) => d.change !== null && d.change >= 10).sort((a, b) => b.change - a.change);
    if (rising.length) insights.push({ tone: 'good', text: `${rising[0].name} improved from ${rising[0].prev_pct}% to ${rising[0].week_pct}% this week.` });
    if (!insights.length) insights.push({ tone: 'good', text: 'Nothing urgent. Everyone has planned, and nothing is stuck.' });

    res.json({
      date,
      today: { people: ppl.length, planned: ppl.length - noPlan.length, eod: ppl.length - noEod.length, goals: goalsToday, done: doneToday },
      week: { pct: weekPct, prev_pct: prevPct, change: weekPct !== null && prevPct !== null ? weekPct - prevPct : null },
      insights,
      no_plan: noPlan.map(({ id, name, department }) => ({ id, name, department })),
      no_eod: noEod.map(({ id, name, department, goals_today, done_today }) => ({ id, name, department, goals_today, done_today })),
      silent: silent.map(({ id, name, department, last_update }) => ({ id, name, department, last_update })),
      blocker_groups: blockerGroups,
      departments: depts,
    });
  })
);

module.exports = router;
