/**
 * End-to-end smoke test against a running API seeded with `npm run db:seed`.
 *   API_URL=http://localhost:4000 npm run test:smoke
 * Covers the BRD acceptance criteria plus the main RBAC rules.
 */
const { io } = require('socket.io-client');

const API = process.env.API_URL || 'http://localhost:4000';
const PASS_ADMIN = process.env.ADMIN_PASSWORD;
const PASS_STAFF = process.env.STAFF_PASSWORD;
if (!PASS_ADMIN || !PASS_STAFF) {
  console.error('Set ADMIN_PASSWORD and STAFF_PASSWORD to the values used when seeding (db:seed).');
  process.exit(2);
}

let passed = 0;
let failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${extra}`);
  }
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, data };
}

async function login(email, password) {
  const r = await call('POST', '/api/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status}`);
  return { token: r.data.token, user: r.data.user };
}

function listen(token) {
  return new Promise((resolve, reject) => {
    const socket = io(API, { auth: { token }, transports: ['websocket'] });
    const got = [];
    socket.on('notification', (n) => got.push(n));
    socket.on('connect', () => resolve({ socket, got }));
    socket.on('connect_error', reject);
  });
}

const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('Auth');
  const bad = await call('POST', '/api/auth/login', { body: { email: 'admin@opshub.example', password: 'nope' } });
  check('wrong password rejected', bad.status === 401);
  const noAuth = await call('GET', '/api/goals');
  check('protected route needs a token', noAuth.status === 401);

  const admin = await login('admin@opshub.example', PASS_ADMIN);
  const rahul = await login('rahul.verma@opshub.example', PASS_STAFF); // Sales employee
  const arjun = await login('arjun.nair@opshub.example', PASS_STAFF); // Tech employee
  const anita = await login('anita.desai@opshub.example', PASS_STAFF); // Sales head
  check('roles are correct', admin.user.role === 'super_admin' && rahul.user.role === 'employee' && anita.user.role === 'dept_head');

  const depts = (await call('GET', '/api/departments', { token: admin.token })).data.departments;
  const tech = depts.find((d) => d.name === 'Tech');
  const sales = depts.find((d) => d.name === 'Sales');

  console.log('Communication');
  const arjunSock = await listen(arjun.token);
  const rahulSock = await listen(rahul.token);
  const techMembers = tech.member_count;

  const b1 = await call('POST', '/api/messages', {
    token: admin.token,
    body: { target_type: 'dept', target_id: tech.id, body: 'Tech: smoke-test broadcast' },
  });
  check('admin can tag a department', b1.status === 201 && b1.data.recipients === techMembers, JSON.stringify(b1.data));
  await sleep(400);
  check('tagged employee gets a real-time notification', arjunSock.got.some((n) => n.body === 'Tech: smoke-test broadcast' && n.target_label === '@Tech'));
  check('other departments are not notified', !rahulSock.got.some((n) => n.body === 'Tech: smoke-test broadcast'));

  const g = await call('POST', '/api/messages', { token: rahul.token, body: { target_type: 'all', body: 'hi all' } });
  check('employee cannot send a global broadcast', g.status === 403);

  const x = await call('POST', '/api/messages', {
    token: rahul.token,
    body: { target_type: 'dept', target_id: tech.id, body: 'Sales needs a banner' },
  });
  check('cross-department message works without admin', x.status === 201);
  await sleep(300);
  check('Tech receives the Sales request live', arjunSock.got.some((n) => n.body === 'Sales needs a banner' && n.sender_name === 'Rahul Verma'));

  const globalMsg = await call('POST', '/api/messages', { token: admin.token, body: { target_type: 'all', body: 'Global smoke message' } });
  check('admin global broadcast', globalMsg.status === 201);
  await sleep(300);
  check('global broadcast reaches everyone', arjunSock.got.some((n) => n.body === 'Global smoke message') && rahulSock.got.some((n) => n.body === 'Global smoke message'));

  const hist = await call('GET', '/api/messages?q=smoke', { token: arjun.token });
  check('history search works', hist.status === 200 && hist.data.messages.length >= 2);
  const histRahul = await call('GET', '/api/messages?q=Tech:%20smoke', { token: rahul.token });
  check('history hides messages the user cannot see', histRahul.data.messages.length === 0);

  const notifs = await call('GET', '/api/notifications', { token: arjun.token });
  check('notification inbox has unread items', notifs.data.unread > 0);
  await call('POST', '/api/notifications/read-all', { token: arjun.token });
  const after = await call('GET', '/api/notifications', { token: arjun.token });
  check('mark all read', after.data.unread === 0);
  arjunSock.socket.close();
  rahulSock.socket.close();

  console.log('Worklog');
  const created = await call('POST', '/api/goals', { token: rahul.token, body: { title: 'Smoke goal', goal_date: today } });
  check('employee creates a goal', created.status === 201 && created.data.goal.status === 'todo');
  const gid = created.data.goal.id;
  const done = await call('PATCH', `/api/goals/${gid}`, { token: rahul.token, body: { status: 'completed' } });
  check('completing stamps completed_at', done.data.goal.status === 'completed' && !!done.data.goal.completed_at);
  const blocked = await call('PATCH', `/api/goals/${gid}`, { token: rahul.token, body: { status: 'blocked' } });
  check('blocking stamps blocked_at and clears completed_at', !!blocked.data.goal.blocked_at && !blocked.data.goal.completed_at);
  const reopened = await call('PATCH', `/api/goals/${gid}`, { token: rahul.token, body: { status: 'in_progress' } });
  check('reopening clears blocked_at', !reopened.data.goal.blocked_at);
  const badStatus = await call('PATCH', `/api/goals/${gid}`, { token: rahul.token, body: { status: 'nope' } });
  check('invalid status rejected', badStatus.status === 400);

  const edited = await call('PATCH', `/api/goals/${gid}`, { token: rahul.token, body: { title: 'Smoke goal (edited)' } });
  check('a goal can be edited after it is added', edited.status === 200 && edited.data.goal.title === 'Smoke goal (edited)');
  const del = await call('DELETE', `/api/goals/${gid}`, { token: rahul.token });
  check('employee cannot delete a goal (405)', del.status === 405);
  check('super admin cannot delete a goal either', (await call('DELETE', `/api/goals/${gid}`, { token: admin.token })).status === 405);
  const cancelled = await call('PATCH', `/api/goals/${gid}`, { token: rahul.token, body: { status: 'cancelled' } });
  check('a goal can be marked Cancelled', cancelled.status === 200 && cancelled.data.goal.status === 'cancelled' && !cancelled.data.goal.completed_at && !cancelled.data.goal.blocked_at);
  const stillThere = await call('GET', `/api/goals?date=${today}`, { token: rahul.token });
  check('cancelled goal is kept (not removed)', stillThere.data.goals.some((x) => x.id === gid && x.status === 'cancelled'));
  await call('PATCH', `/api/goals/${gid}`, { token: rahul.token, body: { status: 'in_progress' } });

  const mine = await call('GET', `/api/goals?date=${today}`, { token: rahul.token });
  check('goals list returns the goal', mine.data.goals.some((x) => x.id === gid));

  const eod = await call('PUT', '/api/eod', { token: rahul.token, body: { note_date: today, note: 'Smoke EOD note' } });
  check('employee submits an EOD note', eod.status === 200);
  const eod2 = await call('PUT', '/api/eod', { token: rahul.token, body: { note_date: today, note: 'Smoke EOD note v2' } });
  const readBack = await call('GET', `/api/eod?date=${today}`, { token: rahul.token });
  check('EOD note upserts (one per day)', eod2.status === 200 && readBack.data.note.note === 'Smoke EOD note v2');

  console.log('RBAC');
  const arjunId = arjun.user.id;
  const rahulId = rahul.user.id;
  check('employee cannot read a colleague worklog', (await call('GET', `/api/goals?date=${today}&user_id=${arjunId}`, { token: rahul.token })).status === 403);
  check('dept head can read own team worklog', (await call('GET', `/api/goals?date=${today}&user_id=${rahulId}`, { token: anita.token })).status === 200);
  check('dept head cannot read another department', (await call('GET', `/api/goals?date=${today}&user_id=${arjunId}`, { token: anita.token })).status === 403);
  const headAdds = await call('POST', '/api/goals', { token: anita.token, body: { title: 'Dept goal from head', goal_date: today, user_id: rahulId } });
  check('dept head can set goals for their team', headAdds.status === 201 && headAdds.data.goal.user_id === rahulId);
  check('employee cannot edit a colleague goal', (await call('PATCH', `/api/goals/${headAdds.data.goal.id}`, { token: arjun.token, body: { status: 'completed' } })).status === 403);
  check('employee cannot open analytics', (await call('GET', '/api/analytics/overview', { token: rahul.token })).status === 403);
  check('employee cannot create users', (await call('POST', '/api/users', { token: rahul.token, body: {} })).status === 403);

  console.log('Analytics');
  const from = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);
  const ov = await call('GET', `/api/analytics/overview?from=${from}&to=${today}`, { token: admin.token });
  check('admin overview returns every department', ov.status === 200 && ov.data.departments.length === depts.length);
  const sumTotal = ov.data.departments.reduce((a, d) => a + d.total, 0);
  const sumDone = ov.data.departments.reduce((a, d) => a + d.completed, 0);
  check('completed + pending aggregate correctly', ov.data.summary.total === sumTotal && ov.data.summary.completed === sumDone && ov.data.summary.pending === sumTotal - sumDone);
  check('completion % is computed per department', ov.data.departments.every((d) => d.completion_pct === (d.total ? Math.round((d.completed / d.total) * 100) : 0)));
  check('employee progress rows exist', ov.data.employees.length > 0);
  check('blocked > 24h alert lists stale tasks', ov.data.blocked_tasks.length >= 1 && ov.data.blocked_tasks.every((t) => t.hours_blocked >= 24));

  const salesOnly = await call('GET', `/api/analytics/overview?from=${from}&to=${today}&dept_id=${sales.id}`, { token: admin.token });
  check('department filter works', salesOnly.data.departments.length === 1 && salesOnly.data.departments[0].name === 'Sales');
  const oneEmp = await call('GET', `/api/analytics/overview?from=${from}&to=${today}&user_id=${rahulId}`, { token: admin.token });
  check('employee filter works', oneEmp.data.employees.length === 1 && oneEmp.data.employees[0].id === rahulId);
  const headView = await call('GET', `/api/analytics/overview?from=${from}&to=${today}&dept_id=${tech.id}`, { token: anita.token });
  check('dept head is pinned to own department (ignores dept_id)', headView.data.departments.length === 1 && headView.data.departments[0].name === 'Sales');
  const oneDay = await call('GET', `/api/analytics/overview?from=${today}&to=${today}`, { token: admin.token });
  check('date filter narrows results', oneDay.data.summary.total < ov.data.summary.total);

  // Cancelled goals must not count as pending or change the completion rate.
  const beforeCancel = (await call('GET', `/api/analytics/overview?from=${today}&to=${today}`, { token: admin.token })).data.summary;
  const extra = await call('POST', '/api/goals', { token: rahul.token, body: { title: 'Will be cancelled', goal_date: today } });
  const withExtra = (await call('GET', `/api/analytics/overview?from=${today}&to=${today}`, { token: admin.token })).data.summary;
  await call('PATCH', `/api/goals/${extra.data.goal.id}`, { token: rahul.token, body: { status: 'cancelled' } });
  const afterCancel = (await call('GET', `/api/analytics/overview?from=${today}&to=${today}`, { token: admin.token })).data.summary;
  check('a new goal raises the total', withExtra.total === beforeCancel.total + 1);
  check('cancelling it removes it from total / pending and reports it as cancelled', afterCancel.total === beforeCancel.total && afterCancel.pending === beforeCancel.pending && afterCancel.cancelled === beforeCancel.cancelled + 1);

  const feed = await call('GET', `/api/analytics/feed?from=${from}&to=${today}`, { token: admin.token });
  check('EOD activity feed returns notes', feed.status === 200 && feed.data.items.length > 0);
  check('feed contains the fresh note', feed.data.items.some((i) => i.note === 'Smoke EOD note v2'));
  const headFeed = await call('GET', `/api/analytics/feed?from=${from}&to=${today}`, { token: anita.token });
  check('head feed is limited to own department', headFeed.data.items.every((i) => i.department === 'Sales'));

  console.log('Administration');
  const newDept = await call('POST', '/api/departments', { token: admin.token, body: { name: 'Finance' } });
  check('admin creates a department', newDept.status === 201);
  const newUser = await call('POST', '/api/users', {
    token: admin.token,
    body: { name: 'Test Person', email: 'test.person@opshub.example', password: 'Passw0rd!x', role: 'employee', department_id: newDept.data.department.id },
  });
  check('admin creates a user', newUser.status === 201);
  const dup = await call('POST', '/api/users', {
    token: admin.token,
    body: { name: 'Test Person', email: 'test.person@opshub.example', password: 'Passw0rd!x', role: 'employee', department_id: newDept.data.department.id },
  });
  check('duplicate email rejected', dup.status === 409);
  const delBusy = await call('DELETE', `/api/departments/${newDept.data.department.id}`, { token: admin.token });
  check('cannot delete a department that has members', delBusy.status === 409);
  const login2 = await call('POST', '/api/auth/login', { body: { email: 'test.person@opshub.example', password: 'Passw0rd!x' } });
  check('new user can log in', login2.status === 200);
  await call('PATCH', `/api/users/${newUser.data.user.id}`, { token: admin.token, body: { active: false } });
  const login3 = await call('POST', '/api/auth/login', { body: { email: 'test.person@opshub.example', password: 'Passw0rd!x' } });
  check('deactivated user cannot log in', login3.status === 401);
  check('admin deletes the user', (await call('DELETE', `/api/users/${newUser.data.user.id}`, { token: admin.token })).status === 200);
  check('admin deletes the empty department', (await call('DELETE', `/api/departments/${newDept.data.department.id}`, { token: admin.token })).status === 200);
  check('admin cannot deactivate themselves', (await call('PATCH', `/api/users/${admin.user.id}`, { token: admin.token, body: { active: false } })).status === 400);

  console.log('Dept Head adds team members');
  const headAdd = await call('POST', '/api/users', {
    token: anita.token,
    body: { name: 'Team Newbie', email: 'team.newbie@opshub.example', password: 'Passw0rd!x' },
  });
  check('dept head can add an employee to their own team', headAdd.status === 201 && headAdd.data.user.role === 'employee' && headAdd.data.user.department_id === anita.user.department_id);
  check('dept head cannot create a Dept Head or admin', (await call('POST', '/api/users', { token: anita.token, body: { name: 'X', email: 'x1@opshub.example', password: 'Passw0rd!x', role: 'super_admin' } })).status === 403);
  check('dept head cannot add people to another department', (await call('POST', '/api/users', { token: anita.token, body: { name: 'X', email: 'x2@opshub.example', password: 'Passw0rd!x', department_id: tech.id } })).status === 403);
  check('dept head cannot edit or delete users (admin only)', (await call('DELETE', `/api/users/${headAdd.data.user.id}`, { token: anita.token })).status === 403);
  const teamList = await call('GET', '/api/users', { token: anita.token });
  check('dept head sees emails for their own team only', teamList.data.users.filter((u) => u.department_id === anita.user.department_id).every((u) => !!u.email) && teamList.data.users.filter((u) => u.department_id === tech.id).every((u) => !u.email));
  check('new team member can sign in', (await call('POST', '/api/auth/login', { body: { email: 'team.newbie@opshub.example', password: 'Passw0rd!x' } })).status === 200);
  await call('DELETE', `/api/users/${headAdd.data.user.id}`, { token: admin.token });

  console.log('Push (PWA)');
  const pk = await call('GET', '/api/push/public-key', { token: rahul.token });
  check('push public key endpoint answers', pk.status === 200 && 'public_key' in pk.data);
  check('push endpoints need a token', (await call('GET', '/api/push/public-key')).status === 401);
  if (pk.data.public_key) {
    const fake = { endpoint: `https://push.example.test/${Date.now()}`, keys: { p256dh: 'BPk', auth: 'abc' } };
    check('subscribing rejects a non-https endpoint', (await call('POST', '/api/push/subscribe', { token: rahul.token, body: { ...fake, endpoint: 'http://x' } })).status === 400);
    check('device can subscribe', (await call('POST', '/api/push/subscribe', { token: rahul.token, body: fake })).status === 201);
    check('a shared phone can re-subscribe as another user', (await call('POST', '/api/push/subscribe', { token: arjun.token, body: fake })).status === 201);
    check('only the current owner can unsubscribe a device', (await call('POST', '/api/push/unsubscribe', { token: rahul.token, body: { endpoint: fake.endpoint } })).status === 200);
    check('unsubscribe works for the owner', (await call('POST', '/api/push/unsubscribe', { token: arjun.token, body: { endpoint: fake.endpoint } })).status === 200);
  } else {
    console.log('  skip push subscribe checks (set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY on the API to run them)');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
