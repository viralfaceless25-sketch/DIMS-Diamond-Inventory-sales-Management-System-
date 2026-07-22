const { Server } = require('socket.io');

let io = null;

function initSockets(httpServer, corsOrigin) {
  io = new Server(httpServer, {
    cors: { origin: corsOrigin || '*', methods: ['GET', 'POST', 'PATCH'] },
  });

  io.on('connection', (socket) => {
    // Clients (dashboard or sales-rep app) join a branch room so we can scope
    // broadcasts, e.g. socket.emit joining branch 'NY' only gets NY events.
    // 'ALL' is used by the dashboard when no branch filter is active.
    socket.on('join-branch', (branch) => {
      socket.join(`branch:${branch || 'ALL'}`);
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

module.exports = { initSockets, getIo, broadcast };
