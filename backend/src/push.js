const webpush = require('web-push');
const pool = require('./db/pool');
const config = require('./config');

const enabled = Boolean(config.vapid.publicKey && config.vapid.privateKey);

if (enabled) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
}

/**
 * Send a push notification to every registered device of the given users.
 * Dead subscriptions (404 / 410 from the push service) are removed automatically.
 * Never throws: push is best-effort and must not break messaging.
 */
async function sendPushToUsers(userIds, { title, body, url = '/messages', tag }) {
  if (!enabled || !userIds.length) return { sent: 0, removed: 0 };

  const { rows } = await pool.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::int[])',
    [userIds]
  );
  const payload = JSON.stringify({
    title: String(title).slice(0, 80),
    body: String(body).slice(0, 160),
    url,
    tag,
  });

  let sent = 0;
  let removed = 0;
  await Promise.all(
    rows.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 60 * 60 * 24, urgency: 'high' }
        );
        sent++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await pool.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]).catch(() => {});
          removed++;
        } else {
          console.error('Push failed:', err.statusCode || err.message);
        }
      }
    })
  );
  return { sent, removed };
}

module.exports = { enabled, sendPushToUsers, publicKey: config.vapid.publicKey };
