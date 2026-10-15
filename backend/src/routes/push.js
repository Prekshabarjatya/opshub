const express = require('express');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { enabled, publicKey, sendPushToUsers } = require('../push');
const { httpError, wrap } = require('../utils');

const router = express.Router();
router.use(authenticate);

// The browser needs this key to create a subscription. null = push not configured on the server.
router.get(
  '/public-key',
  wrap(async (req, res) => {
    res.json({ public_key: enabled ? publicKey : null });
  })
);

// Register (or re-assign) this device for the signed-in user. A shared phone that logs in as someone
// else simply moves the subscription to the new user.
router.post(
  '/subscribe',
  wrap(async (req, res) => {
    if (!enabled) throw httpError(503, 'Push notifications are not configured on the server');
    const { endpoint, keys } = req.body || {};
    if (typeof endpoint !== 'string' || !/^https:\/\//.test(endpoint) || endpoint.length > 2048) {
      throw httpError(400, 'Invalid subscription endpoint');
    }
    if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
      throw httpError(400, 'Invalid subscription keys');
    }
    await pool.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint)
       DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
                     auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
      [req.user.id, endpoint, keys.p256dh, keys.auth, String(req.headers['user-agent'] || '').slice(0, 300)]
    );
    res.status(201).json({ ok: true });
  })
);

router.post(
  '/unsubscribe',
  wrap(async (req, res) => {
    const { endpoint } = req.body || {};
    if (typeof endpoint !== 'string') throw httpError(400, 'Endpoint is required');
    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2', [
      endpoint,
      req.user.id,
    ]);
    res.json({ ok: true });
  })
);

// "Send test notification" button.
router.post(
  '/test',
  wrap(async (req, res) => {
    if (!enabled) throw httpError(503, 'Push notifications are not configured on the server');
    const result = await sendPushToUsers([req.user.id], {
      title: 'OpsHub test notification',
      body: 'Alerts are working on this device.',
      url: '/messages',
      tag: 'opshub-test',
    });
    res.json(result);
  })
);

module.exports = router;
