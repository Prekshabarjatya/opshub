/**
 * Unit-tests public/sw.js (the push / notification-click handlers) by running it in a sandbox with a
 * mocked service-worker scope. Run: npm run test:sw
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://ops.example.com';

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

function makeWorker({ userAgent = 'Mozilla/5.0 (Linux; Android 14) Chrome/120', windows = [] } = {}) {
  const listeners = {};
  const shown = [];
  const calls = { opened: [], focused: 0, navigated: [] };

  const wins = windows.map((w) => ({
    url: w.url || `${ORIGIN}/worklog`,
    visibilityState: w.visibilityState || 'hidden',
    focused: !!w.focused,
    focus: async () => { calls.focused++; },
    navigate: async (u) => { calls.navigated.push(u); },
  }));

  const self = {
    navigator: { userAgent },
    location: { origin: ORIGIN },
    registration: { showNotification: async (title, options) => shown.push({ title, options }) },
    clients: {
      claim: async () => {},
      matchAll: async () => wins,
      openWindow: async (u) => { calls.opened.push(u); },
    },
    skipWaiting: () => {},
    addEventListener: (type, fn) => { listeners[type] = fn; },
  };
  vm.runInNewContext(source, { self, URL, Promise, JSON, String }, { filename: 'sw.js' });

  const fire = async (type, event) => {
    let pending = Promise.resolve();
    listeners[type]({ ...event, waitUntil: (p) => { pending = p; } });
    await pending;
  };
  return { fire, shown, calls, listeners };
}

const pushEvent = (obj) => ({ data: { json: () => obj, text: () => JSON.stringify(obj) } });

(async () => {
  console.log('push event');
  let w = makeWorker();
  await w.fire('push', pushEvent({ title: 'Priya → @Tech', body: 'Deploy at 5pm', url: '/messages', tag: 'msg-7' }));
  check('shows a notification when the app is not in front', w.shown.length === 1);
  const n = w.shown[0] || { title: '', options: {} };
  check('title and body come from the payload', n.title === 'Priya → @Tech' && n.options.body === 'Deploy at 5pm');
  check('uses the OpsHub icon and badge', n.options.icon === '/icons/icon-192.png' && n.options.badge === '/icons/badge-96.png');
  check('tag lets a newer message replace an older one', n.options.tag === 'msg-7');
  check('click target is carried in notification data', n.options.data && n.options.data.url === '/messages');

  w = makeWorker();
  await w.fire('push', { data: null });
  check('empty push still shows a default OpsHub notification', w.shown.length === 1 && w.shown[0].title === 'OpsHub');

  w = makeWorker();
  await w.fire('push', { data: { json: () => { throw new Error('bad json'); }, text: () => 'plain text' } });
  check('non-JSON payload falls back to plain text', w.shown.length === 1 && w.shown[0].options.body === 'plain text');

  w = makeWorker({ windows: [{ visibilityState: 'visible', focused: true }] });
  await w.fire('push', pushEvent({ title: 'x', body: 'y' }));
  check('Android/desktop: skipped when the app is open and focused (in-app toast covers it)', w.shown.length === 0);

  w = makeWorker({ windows: [{ visibilityState: 'visible', focused: false }] });
  await w.fire('push', pushEvent({ title: 'x', body: 'y' }));
  check('shown when the app is open but not focused', w.shown.length === 1);

  w = makeWorker({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1', windows: [{ visibilityState: 'visible', focused: true }] });
  await w.fire('push', pushEvent({ title: 'x', body: 'y' }));
  check('iPhone/iPad: ALWAYS shows (Apple revokes push if a push shows nothing)', w.shown.length === 1);

  console.log('notification click');
  const clickEvent = (url) => ({ notification: { close() { this.closed = true; }, data: { url } } });

  w = makeWorker({ windows: [] });
  let ev = clickEvent('/messages');
  await w.fire('notificationclick', ev);
  check('closes the notification', ev.notification.closed === true);
  check('opens the app at the target page when it is not running', w.calls.opened.length === 1 && w.calls.opened[0] === `${ORIGIN}/messages`);

  w = makeWorker({ windows: [{ url: `${ORIGIN}/analytics` }] });
  await w.fire('notificationclick', clickEvent('/messages'));
  check('focuses the running app and navigates it', w.calls.focused === 1 && w.calls.navigated[0] === `${ORIGIN}/messages` && w.calls.opened.length === 0);

  w = makeWorker({ windows: [{ url: 'https://other.example.org/' }] });
  await w.fire('notificationclick', clickEvent('/messages'));
  check('ignores windows from other origins', w.calls.opened.length === 1);

  w = makeWorker({ windows: [] });
  await w.fire('notificationclick', { notification: { close() {}, data: { url: 'https://evil.example.org/phish' } } });
  check('an external URL in a payload is ignored: the app opens on its own Messages page', w.calls.opened.length === 1 && w.calls.opened[0] === `${ORIGIN}/messages`, JSON.stringify(w.calls.opened));

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
