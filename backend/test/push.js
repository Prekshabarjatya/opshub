/**
 * Verifies the Web Push pipeline without any real push service:
 *  - a message payload is encrypted and delivered to a (mock) push endpoint with a VAPID header
 *  - a dead subscription (HTTP 410) is pruned automatically
 * Needs DATABASE_URL (seeded DB) and openssl. Run: npm run test:push
 */
const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const webpush = require('web-push');

// Configure VAPID + accept the mock server's self-signed certificate BEFORE loading app modules.
const keys = webpush.generateVAPIDKeys();
process.env.VAPID_PUBLIC_KEY = keys.publicKey;
process.env.VAPID_PRIVATE_KEY = keys.privateKey;
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const pool = require('../src/db/pool');
const { sendPushToUsers, enabled } = require('../src/push');

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

function fakeSubscription(endpoint) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint,
    p256dh: ecdh.getPublicKey().toString('base64url'),
    auth: crypto.randomBytes(16).toString('base64url'),
  };
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opshub-push-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'),
  ], { stdio: 'ignore' });

  const received = [];
  const server = https.createServer(
    { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) },
    (req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push({ url: req.url, headers: req.headers, bytes: Buffer.concat(chunks).length });
        res.statusCode = req.url === '/gone' ? 410 : 201;
        res.end();
      });
    }
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `https://127.0.0.1:${server.address().port}`;

  const { rows } = await pool.query("SELECT id FROM users WHERE role = 'employee' ORDER BY id LIMIT 1");
  const userId = rows[0].id;

  try {
    check('push is enabled when VAPID keys are set', enabled === true);

    for (const p of ['/ok', '/gone']) {
      const s = fakeSubscription(base + p);
      await pool.query(
        'INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4)',
        [userId, s.endpoint, s.p256dh, s.auth]
      );
    }

    const result = await sendPushToUsers([userId], { title: 'Priya → @Tech', body: 'Deploy at 5pm', tag: 'msg-1' });
    const ok = received.find((r) => r.url === '/ok');

    check('notification delivered to the live device', result.sent === 1 && !!ok);
    check('payload is encrypted (aes128gcm) and non-empty', ok && ok.headers['content-encoding'] === 'aes128gcm' && ok.bytes > 0);
    check('request carries a VAPID Authorization header', ok && /^vapid /i.test(ok.headers.authorization || ''));
    check('high urgency + TTL are set', ok && ok.headers.urgency === 'high' && Number(ok.headers.ttl) > 0);

    check('expired device (410) is reported as removed', result.removed === 1);
    const left = await pool.query(
      'SELECT endpoint FROM push_subscriptions WHERE user_id = $1 AND endpoint LIKE $2',
      [userId, `${base}%`]
    );
    check('dead subscription pruned, live one kept', left.rows.length === 1 && left.rows[0].endpoint.endsWith('/ok'));

    const none = await sendPushToUsers([], { title: 't', body: 'b' });
    check('no recipients = no work', none.sent === 0);
  } finally {
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint LIKE $1', [`${base}%`]);
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.error('Push test crashed:', err);
  process.exit(1);
});
