const http = require('http');
const { Server } = require('socket.io');
const config = require('./config');
const app = require('./app');
const { userFromToken } = require('./middleware/auth');
const { setIO } = require('./realtime');

const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: config.clientOrigins },
});
setIO(io);

// Authenticate every socket with the same JWT used for the REST API.
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) throw new Error('missing token');
    socket.data.user = await userFromToken(token);
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  const user = socket.data.user;
  socket.join(`user:${user.id}`);
  if (user.role === 'super_admin') socket.join('admins');
  if (user.role === 'dept_head' && user.department_id) socket.join(`head:${user.department_id}`);
});

server.listen(config.port, () => {
  console.log(`OpsHub API listening on http://localhost:${config.port}`);
});

function shutdown() {
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
