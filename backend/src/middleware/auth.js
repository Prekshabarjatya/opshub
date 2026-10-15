const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const config = require('../config');
const { httpError, wrap } = require('../utils');

async function loadUser(id) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.department_id, u.active,
            d.name AS department_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.id = $1`,
    [id]
  );
  return rows[0] || null;
}

async function userFromToken(token) {
  const payload = jwt.verify(token, config.jwtSecret);
  const user = await loadUser(payload.sub);
  if (!user || !user.active) throw new Error('inactive');
  return user;
}

const authenticate = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw httpError(401, 'Authentication required');
  try {
    req.user = await userFromToken(token);
  } catch {
    throw httpError(401, 'Invalid or expired session');
  }
  next();
});

const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(httpError(403, 'You do not have permission to do this'));
    }
    next();
  };

module.exports = { authenticate, requireRole, loadUser, userFromToken };
