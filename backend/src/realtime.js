// Holds the Socket.io instance so route modules can emit without circular imports.
let io = null;

function setIO(instance) {
  io = instance;
}

function emitToUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}

// Tell dashboards (admins + the relevant dept head) that goals / EOD notes changed.
function emitActivity(departmentId) {
  if (!io) return;
  let target = io.to('admins');
  if (departmentId) target = target.to(`head:${departmentId}`);
  target.emit('activity', { at: new Date().toISOString() });
}

module.exports = { setIO, emitToUser, emitActivity };
