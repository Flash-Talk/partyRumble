'use strict';

const uno = require('./unoService');
const amongus = require('./amongusService');

/**
 * Wire socket.io events to the RoomManager. The server relays controller input
 * for Penalty Rumble (the TV simulates it), but is authoritative for UNO.
 *
 * @param {import('socket.io').Server} io
 * @param {import('./RoomManager')} rooms
 */
function registerHandlers(io, rooms) {
  const emitToTv = (room, event, payload) => {
    if (room && room.tvSocketId) io.to(room.tvSocketId).emit(event, payload);
  };

  io.on('connection', (socket) => {
    // --- TV boots and requests a room (bootstrap event) --------------------
    // payload: { token?, roomCode? }. A host token lets a reconnecting TV
    // reclaim its room + roster after a network blip.
    socket.on('create_room', (payload = {}) => {
      const token = payload.token || null;
      const resumeCode = payload.roomCode ? String(payload.roomCode).toUpperCase() : null;

      // Reconnecting host: reattach and replay the current roster.
      if (resumeCode && token) {
        const room = rooms.resumeRoom(resumeCode, socket.id, token);
        if (room) {
          socket.data.role = 'tv';
          socket.data.roomCode = room.code;
          socket.join(room.code);
          socket.emit('room_created', { roomCode: room.code, resumed: true });
          for (const p of room.players.values()) {
            socket.emit('player_joined', { id: p.id, slot: p.slot, name: p.name, color: p.color });
          }
          return;
        }
      }

      // One room per TV socket; reuse if it already made one.
      const existing = rooms.findRoomByTv(socket.id);
      if (existing) {
        socket.emit('room_created', { roomCode: existing.code });
        return;
      }

      const roomCode = rooms.createRoom(socket.id, token);
      socket.data.role = 'tv';
      socket.data.roomCode = roomCode;
      socket.join(roomCode);
      socket.emit('room_created', { roomCode });
    });

    // --- Mobile joins a room ----------------------------------------------
    socket.on('join_room', (payload = {}) => {
      const roomCode = String(payload.roomCode || '').trim().toUpperCase();
      const result = rooms.addPlayer(roomCode, socket.id, payload.playerName);

      if (result.error) {
        socket.emit('room_error', { message: result.error });
        return;
      }

      const { room, player } = result;
      socket.data.role = 'player';
      socket.data.roomCode = roomCode;
      socket.data.slot = player.slot;
      socket.join(roomCode);

      socket.emit('join_success', { slot: player.slot, color: player.color });
      emitToTv(room, 'player_joined', {
        id: player.id,
        slot: player.slot,
        name: player.name,
        color: player.color,
      });

      // Rejoined mid-round? Re-send the private game state their UI needs.
      if (room.unoGame) uno.resendHand(io, room, player.slot);
      if (room.amongus) amongus.resendRole(io, room, player.slot);
    });

    // --- UNO: TV starts a round; players act -------------------------------
    socket.on('start_uno', () => {
      if (socket.data.role !== 'tv') return;
      const room = rooms.getRoom(socket.data.roomCode);
      if (room) uno.startUno(io, room);
    });

    socket.on('uno_action', (payload) => {
      if (socket.data.role !== 'player') return;
      const room = rooms.getRoom(socket.data.roomCode);
      if (room) uno.handleUnoAction(io, room, socket.data.slot, payload || {});
    });

    // --- Among Us: TV starts a round --------------------------------------
    socket.on('start_amongus', () => {
      if (socket.data.role !== 'tv') return;
      const room = rooms.getRoom(socket.data.roomCode);
      if (room) amongus.start(io, room);
    });

    // --- Controller input --------------------------------------------------
    // Penalty Rumble: relayed to the TV (it simulates). Among Us: consumed by
    // the server (it simulates), so it is NOT relayed.
    socket.on('controller_input', (payload = {}) => {
      if (socket.data.role !== 'player') return;
      const room = rooms.getRoom(socket.data.roomCode);
      if (!room) return;
      if (room.currentGame === 'amongus' && room.amongus) {
        amongus.handleInput(room, socket.data.slot, payload);
        return;
      }
      emitToTv(room, 'game_input', {
        slot: socket.data.slot,
        type: payload.type,
        id: payload.id,
        value: payload.value,
      });
    });

    // --- Disconnects -------------------------------------------------------
    socket.on('disconnect', () => {
      const roomCode = socket.data.roomCode;
      if (!roomCode) return;

      if (socket.data.role === 'tv') {
        // Keep the room briefly so the host can reconnect (internet blips).
        rooms.startTvGrace(roomCode, socket.id);
      } else if (socket.data.role === 'player') {
        // Hold the slot; onPlayerLeft (grace expiry) notifies the TV.
        rooms.startGrace(roomCode, socket.id);
      }
    });
  });
}

module.exports = registerHandlers;
