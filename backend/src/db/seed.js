/**
 * Demo data: departments, users for all three roles, a week of goals, EOD notes and messages.
 * DESTRUCTIVE: wipes all OpsHub tables first. Refuses to run in production unless --force is passed.
 */
const bcrypt = require('bcryptjs');
const pool = require('./pool');
const init = require('./init');
const config = require('../config');

// Passwords come from the environment, or are generated randomly and printed once.
const genPassword = () => require('crypto').randomBytes(9).toString('base64url');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || genPassword();
const STAFF_PASSWORD = process.env.STAFF_PASSWORD || genPassword();

const DEPARTMENTS = {
  Sales: {
    head: 'Anita Desai',
    staff: ['Rahul Verma', 'Sneha Iyer'],
    goals: ['Follow up with 10 warm leads', 'Update CRM pipeline', 'Send marketplace partner proposal', 'Prepare weekly sales report', 'Call back lapsed customers'],
  },
  Tech: {
    head: 'Vikram Singh',
    staff: ['Arjun Nair', 'Meera Joshi'],
    goals: ['Fix checkout page bug', 'Deploy inventory sync service', 'Review pull requests', 'Optimize product search query', 'Set up error monitoring alerts'],
  },
  Marketing: {
    head: 'Neha Kapoor',
    staff: ['Rohan Gupta', 'Divya Menon'],
    goals: ['Draft festive campaign copy', 'Schedule social posts', 'Analyse ad spend ROAS', 'Brief influencer partners', 'Refresh product page SEO'],
  },
  Support: {
    head: 'Karan Mehta',
    staff: ['Aman Khanna', 'Pooja Reddy'],
    goals: ['Clear open ticket backlog', 'Update returns FAQ', 'Call escalated customers', 'Audit chat transcripts', 'Train new agent on refunds'],
  },
  Operations: {
    head: 'Sunita Rao',
    staff: ['Sanjay Patil', 'Ritu Bansal'],
    goals: ['Reconcile warehouse stock', 'Book courier pickups', 'Resolve delayed shipments', 'Vendor payment follow-up', 'Cycle count aisle B'],
  },
};

const EOD_NOTES = [
  'Finished the planned items. One dependency slipped to tomorrow, no major hurdles.',
  'Good progress today. Waiting on another team for one approval.',
  'Completed most goals; spent extra time on an urgent customer escalation.',
  'Wrapped up the key tasks. Will carry one item over and start with it in the morning.',
  'Slower day because of system slowness, but the priority work is done.',
];

// Small deterministic PRNG so reseeding gives the same shape of data.
let seedState = 42;
const rand = () => {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
};

const emailFor = (name) => `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@opshub.example`;

function isoDaysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function seed() {
  if (config.isProd && !process.argv.includes('--force')) {
    console.error('Refusing to wipe a production database. Re-run with --force if you really mean it.');
    process.exit(1);
  }

  await init();
  await pool.query(
    'TRUNCATE notifications, messages, eod_notes, goals, users, departments RESTART IDENTITY CASCADE'
  );

  const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const staffHash = await bcrypt.hash(STAFF_PASSWORD, 10);

  const admin = await pool.query(
    `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'super_admin') RETURNING id`,
    ['Priya Sharma', 'admin@opshub.example', adminHash]
  );
  const adminId = admin.rows[0].id;

  const staff = []; // { id, name, dept, deptId, role, goals }
  for (const [deptName, cfg] of Object.entries(DEPARTMENTS)) {
    const d = await pool.query('INSERT INTO departments (name) VALUES ($1) RETURNING id', [deptName]);
    const deptId = d.rows[0].id;
    const people = [
      { name: cfg.head, role: 'dept_head' },
      ...cfg.staff.map((name) => ({ name, role: 'employee' })),
    ];
    for (const p of people) {
      const u = await pool.query(
        `INSERT INTO users (name, email, password_hash, role, department_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [p.name, emailFor(p.name), staffHash, p.role, deptId]
      );
      staff.push({ id: u.rows[0].id, name: p.name, dept: deptName, deptId, role: p.role, goals: cfg.goals });
    }
  }

  // Goals for today and the previous 6 days.
  let blockedForced = false;
  for (const person of staff) {
    for (let ago = 6; ago >= 0; ago--) {
      const date = isoDaysAgo(ago);
      const count = 3 + Math.floor(rand() * 2); // 3-4 goals
      const titles = [...person.goals].sort(() => rand() - 0.5).slice(0, count);
      for (let i = 0; i < titles.length; i++) {
        let status;
        const r = rand();
        if (ago > 0) status = r < 0.72 ? 'completed' : r < 0.84 ? 'in_progress' : r < 0.93 ? 'todo' : 'blocked';
        else status = r < 0.3 ? 'completed' : r < 0.6 ? 'in_progress' : r < 0.9 ? 'todo' : 'blocked';

        // Guarantee one stale (>24h) blocked task so the alert is visible in the demo.
        if (!blockedForced && person.name === 'Arjun Nair' && ago === 2 && i === 0) {
          status = 'blocked';
          blockedForced = true;
        }

        const created = new Date(`${date}T09:${String(10 + i * 7).padStart(2, '0')}:00Z`);
        const completedAt = status === 'completed' ? new Date(created.getTime() + (2 + rand() * 6) * 3600000) : null;
        const blockedAt =
          status === 'blocked'
            ? ago === 0
              ? new Date(Date.now() - 3 * 3600000)
              : new Date(Date.now() - (ago * 24 + 6) * 3600000)
            : null;

        await pool.query(
          `INSERT INTO goals (user_id, created_by, goal_date, title, status, created_at, updated_at, completed_at, blocked_at)
           VALUES ($1, $1, $2, $3, $4, $5, $5, $6, $7)`,
          [person.id, date, titles[i], status, created, completedAt, blockedAt]
        );
      }

      // EOD notes for past days (most people) and a few for today.
      if ((ago > 0 && rand() < 0.85) || (ago === 0 && rand() < 0.35)) {
        const note = EOD_NOTES[Math.floor(rand() * EOD_NOTES.length)];
        const at = new Date(`${date}T17:${String(10 + Math.floor(rand() * 40))}:00Z`);
        await pool.query(
          `INSERT INTO eod_notes (user_id, note_date, note, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $4)`,
          [person.id, date, note, at]
        );
      }
    }
  }

  // A few messages (with notifications) so the inbox is not empty.
  const byName = Object.fromEntries(staff.map((s) => [s.name, s]));
  async function message(senderId, type, targetDept, targetUser, body, hoursAgo, recipients, read) {
    const at = new Date(Date.now() - hoursAgo * 3600000);
    const m = await pool.query(
      `INSERT INTO messages (sender_id, target_type, target_dept_id, target_user_id, body, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [senderId, type, targetDept, targetUser, body, at]
    );
    for (const uid of recipients) {
      await pool.query(
        'INSERT INTO notifications (user_id, message_id, is_read, created_at) VALUES ($1, $2, $3, $4)',
        [uid, m.rows[0].id, read, at]
      );
    }
  }

  const everyone = staff.map((s) => s.id);
  const inDept = (name) => staff.filter((s) => s.dept === name).map((s) => s.id);
  const techDeptId = byName['Vikram Singh'].deptId;
  const salesDeptId = byName['Anita Desai'].deptId;

  await message(adminId, 'all', null, null, 'Festive sale starts Monday. Please make sure all open orders are processed by Friday EOD.', 52, everyone, true);
  await message(adminId, 'dept', techDeptId, null, 'Tech team: checkout stability is the top priority this week. Post blockers here as soon as they appear.', 26, inDept('Tech'), false);
  await message(byName['Rahul Verma'].id, 'dept', techDeptId, null, 'Request from Sales: the partner pricing page needs a bulk-discount banner. Can someone pick this up this week?', 8, inDept('Tech'), false);
  await message(adminId, 'user', null, byName['Rahul Verma'].id, 'Rahul, please share the Q4 partner pipeline numbers by tomorrow noon.', 4, [byName['Rahul Verma'].id], false);
  await message(byName['Anita Desai'].id, 'dept', salesDeptId, null, 'Team huddle at 11:30 to review this week\'s targets.', 2, inDept('Sales').filter((id) => id !== byName['Anita Desai'].id), false);

  console.log('Seed complete.');
  console.log('  Super Admin : admin@opshub.example');
  console.log('  Dept Head   : anita.desai@opshub.example (Sales), vikram.singh@opshub.example (Tech), ...');
  console.log('  Employee    : rahul.verma@opshub.example, arjun.nair@opshub.example, ...');
  if (!process.env.ADMIN_PASSWORD) console.log(`  Admin password (generated, shown once): ${ADMIN_PASSWORD}`);
  if (!process.env.STAFF_PASSWORD) console.log(`  Staff password (generated, shown once): ${STAFF_PASSWORD}`);
  console.log('  Demo data only. Set ADMIN_PASSWORD / STAFF_PASSWORD to choose your own.');
}

seed()
  .then(() => pool.end())
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
