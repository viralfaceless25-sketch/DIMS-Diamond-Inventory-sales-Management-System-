const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { JWT_SECRET } = require('../middleware/auth');

let io = null;

async function authenticateToken(token, dependencies = {}) {
  const verify = dependencies.verify || ((value) => jwt.verify(value, JWT_SECRET));
  const query = dependencies.query || ((...args) => pool.query(...args));
  if (!token) throw new Error('Invalid or expired socket session');

  try {
    const payload = verify(token);
    const { rows } = await query(
      `SELECT u.id, u.role, u.is_active, u.token_version, u.must_change_password,
              sr.branch
       FROM users u
       LEFT JOIN sales_reps sr ON sr.id = u.sales_rep_id
       WHERE u.id = $1`,
      [payload.id]
    );
    const user = rows[0];
    if (!user || !user.is_active || user.must_change_password || user.token_version !== payload.tokenVersion) {
      throw new Error('Invalid or expired socket session');
    }
    return { id: user.id, role: user.role, branch: user.branch || null };
  } catch (error) {
    throw new Error('Invalid or expired socket session');
  }
}

function resolveRoom(user, requestedBranch) {
  const branch = String(requestedBranch || '').trim().toUpperCase();
  if (!/^(ALL|[A-Z]{2,4})$/.test(branch)) return null;
  if (user.role === 'inventory' || user.role === 'admin') return `branch:${branch}`;
  if (user.role === 'sales_rep' && user.branch === branch) return `branch:${branch}`;
  return null;
}

function initSockets(httpServer, corsOrigin) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin || '*', methods: ['GET', 'POST', 'PATCH'] },
  });

  io.use(async (socket, next) => {
    try {
      socket.data.user = await authenticateToken(socket.handshake.auth?.token);
      next();
    } catch (error) {
      next(new Error('Not authenticated'));
    }
  });

  io.on('connection', (socket) => {
    // Clients (dashboard or sales-rep app) join a branch room so we can scope
    // broadcasts, e.g. socket.emit joining branch 'NY' only gets NY events.
    // 'ALL' is used by the dashboard when no branch filter is active.
    socket.on('join-branch', (branch, acknowledge) => {
      const room = resolveRoom(socket.data.user, branch);
      if (!room) {
        if (typeof acknowledge === 'function') acknowledge({ ok: false });
        return;
      }
      for (const joined of socket.rooms) {
        if (joined.startsWith('branch:')) socket.leave(joined);
      }
      socket.join(room);
      if (typeof acknowledge === 'function') acknowledge({ ok: true, room });
    });
  });

  return io;
}

function getIo() {
  if (!io) throw new Error('Sockets not initialized yet — call initSockets first');
  return io;
}

/**
 * Broadcasts an event to everyone watching a given branch, plus everyone
 * watching 'ALL' (the dashboard's default unfiltered view).
 */
function broadcast(branch, event, payload) {
  if (!io) return;
  io.to(`branch:${branch}`).to('branch:ALL').emit(event, payload);
}

module.exports = { initSockets, getIo, broadcast, authenticateToken, resolveRoom };
