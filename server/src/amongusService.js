'use strict';

// Glue between sockets and the authoritative AmongUsGame. Runs a per-room tick
// loop that advances the phase machine (play -> meeting -> reveal -> play/over),
// broadcasts anonymized state to the TV and each phone's private view, and deals
// private roles. Movement comes via controller_input; kill/vote via amongus_action.

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

function broadcast(io, room, now) {
  const game = room.amongus;
  if (!game) return;
  io.to(room.tvSocketId).emit('amongus_state', game.publicState(now));
  for (const slot of game.slots) {
    const sid = room.slotOwners[slot];
    if (sid) io.to(sid).emit('amongus_you', game.privateFor(slot, now));
  }
}

function tick(io, room) {
  const game = room.amongus;
  if (!game) return;
  const now = Date.now();

  if (game.phase === 'play') game.step(TICK_MS / 1000);
  else if (game.phase === 'meeting' && game.shouldResolve(now)) game.resolveMeeting(now);
  else if (game.phase === 'reveal' && game.revealDone(now)) game.startPlayRound(now);

  broadcast(io, room, now);

  if (game.phase === 'over') {
    io.to(room.code).emit('amongus_over', { winner: game.winner });
    stop(room);
  }
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
  game.startPlayRound(Date.now());

  io.to(room.tvSocketId).emit('amongus_start', { map: MAP });
  for (const slot of slots) {
    const sid = room.slotOwners[slot];
    if (sid) io.to(sid).emit('amongus_role', game.roleFor(slot));
  }

  room.amongusLoop = setInterval(() => tick(io, room), TICK_MS);
  if (room.amongusLoop.unref) room.amongusLoop.unref();
}

function handleInput(room, slot, payload = {}) {
  const game = room.amongus;
  if (!game || payload.type !== 'AXIS') return;
  game.setInputAxis(slot, payload.id, payload.value);
}

function handleAction(room, slot, payload = {}) {
  const game = room.amongus;
  if (!game) return;
  const now = Date.now();
  if (payload.type === 'kill') game.tryKill(slot, now);
  else if (payload.type === 'vote') game.vote(slot, payload.target);
}

function resendRole(io, room, slot) {
  const game = room.amongus;
  if (!game) return;
  const role = game.roleFor(slot);
  const sid = room.slotOwners[slot];
  if (role && sid) {
    io.to(sid).emit('amongus_role', role);
    io.to(sid).emit('amongus_you', game.privateFor(slot, Date.now()));
  }
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
  const now = Date.now();
  // A departure can end the game (win by parity, or too few players).
  if (game.slots.length < config.MIN_PLAYERS_AMONGUS) {
    io.to(room.code).emit('amongus_over', { winner: game.winner || null, reason: 'not enough players' });
    stop(room);
  }
}

module.exports = { start, handleInput, handleAction, resendRole, stop, handlePlayerLeft, MAP };
