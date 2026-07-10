'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./src/config');
const RoomManager = require('./src/RoomManager');
const registerHandlers = require('./src/handlers');
const uno = require('./src/unoService');
const amongus = require('./src/amongusService');

const ROOT = path.join(__dirname, '..');

/**
 * Build the HTTP + socket.io server. Exported as a factory so tests can spin up
 * throwaway instances on ephemeral ports with config overrides.
 *
 * @param {object} [overrides] partial config (e.g. { DISCONNECT_GRACE_MS: 200 })
 */
function createServer(overrides = {}) {
  const cfg = { ...config, ...overrides };

  const app = express();

  // Health check for the host platform (Render pings this).
  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // The single Node process also serves both web apps.
  app.use('/tv', express.static(path.join(ROOT, 'tv-screen')));
  app.use('/', express.static(path.join(ROOT, 'mobile-controller')));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*' } });

  const rooms = new RoomManager(cfg, {
    onPlayerLeft: (roomCode, payload) => {
      const room = rooms.getRoom(roomCode);
      if (!room) return;
      io.to(room.tvSocketId).emit('player_left', payload);
      if (room.unoGame) uno.handlePlayerLeftUno(io, room, payload.slot);
      if (room.amongus) amongus.handlePlayerLeft(io, room, payload.slot);
    },
    onRoomClosed: (roomCode) => {
      // Host never came back — tell any remaining phones.
      io.to(roomCode).emit('room_error', {
        message: 'Host disconnected. Ask them to reopen the game screen.',
      });
    },
  });

  registerHandlers(io, rooms);

  return { app, httpServer, io, rooms, config: cfg };
}

// Auto-start only when run directly (`node index.js` / `npm run dev`).
if (require.main === module) {
  const { httpServer } = createServer();
  const PORT = process.env.PORT || 3000;
  httpServer.listen(PORT, () => {
    console.log(`\n  4-Way Penalty Rumble server listening on :${PORT}`);
    console.log(`  TV screen : http://localhost:${PORT}/tv`);
    console.log(`  Controller: http://localhost:${PORT}/`);
    console.log(`  (on phones, use http://<this-pc-lan-ip>:${PORT}/ )\n`);
  });
}

module.exports = { createServer };
