class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const httpError = (status, message) => new HttpError(status, message);

// Wrap async route handlers so rejected promises reach the error middleware.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// null for empty, NaN for invalid, integer otherwise.
function toInt(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function escapeLike(s) {
  return s.replace(/[\\%_]/g, '\\$&');
}

// RBAC: who may read/modify another user's worklog.
function canAccessUser(actor, target) {
  if (actor.role === 'super_admin') return true;
  if (actor.id === target.id) return true;
  if (actor.role === 'dept_head' && actor.department_id && target.department_id === actor.department_id) {
    return true;
  }
  return false;
}

module.exports = { HttpError, httpError, wrap, isDate, toInt, todayISO, escapeLike, canAccessUser };
