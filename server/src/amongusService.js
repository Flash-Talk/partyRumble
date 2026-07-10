'use strict';

// Glue between sockets and the authoritative AmongUsGame (Phase 1: movement +
// roles). Runs a per-room tick loop that steps the sim and broadcasts positions
// to the TV; deals each phone its private role.

const { AmongUsGame } = require('./amongus/AmongUsGame');
const { MAP } = require('./amongus/map');
const config = require('./config');

const TICK_MS = 50; // 20 Hz

function slotMeta(room) {
  const meta = {};
  for (const p of room.players.values()) meta[p.slot] = { name: p.name, color: p.color };
  for (const [slot, g] of room.grace) meta[slot] = { name: g.name, color: g.color };
  return meta;
}

function start(io, room) {
  const slots = Object.keys(room.slotOwners).sort();
  if (slots.length < config.MIN_PLAYERS_AMONGUS) {
    io.to(room.tvSocketId).emit('amongus_error', { message: `Need at least ${config.MIN_PLAYERS_AMONGUS} players` });
    return;
  }

  const game = new AmongUsGame(slots, slotMeta(room));
  room.amongus = game;
  room.currentGame = 'amongus';

  io.to(room.tvSocketId).emit('amongus_start', { map: MAP });
  for (const slot of slots) {
    const sid = room.slotOwners[slot];
    if (sid) io.to(sid).emit('amongus_role', game.roleFor(slot));
  }

  room.amongusLoop = setInterval(() => {
    game.step(TICK_MS / 1000);
    io.to(room.tvSocketId).emit('amongus_state', game.publicState());
  }, TICK_MS);
  if (room.amongusLoop.unref) room.amongusLoop.unref();
}

function handleInput(room, slot, payload = {}) {
  const game = room.amongus;
  if (!game || payload.type !== 'AXIS') return;
  game.setInputAxis(slot, payload.id, payload.value);
}

function resendRole(io, room, slot) {
  const game = room.amongus;
  if (!game) return;
  const role = game.roleFor(slot);
  const sid = room.slotOwners[slot];
  if (role && sid) io.to(sid).emit('amongus_role', role);
}

function stop(room) {
  if (room.amongusLoop) { clearInterval(room.amongusLoop); room.amongusLoop = null; }
  room.amongus = null;
  if (room.currentGame === 'amongus') room.currentGame = 'penalty';
}

function handlePlayerLeft(io, room, slot) {
  const game = room.amongus;
  if (!game) return;
  game.removePlayer(slot);
  if (game.slots.length < config.MIN_PLAYERS_AMONGUS) {
    io.to(room.code).emit('amongus_over', { winner: null, reason: 'not enough players' });
    stop(room);
  }
}

module.exports = { start, handleInput, resendRole, stop, handlePlayerLeft, MAP };
