'use strict';

// Glue between socket.io and the authoritative RummyGame: starts the game,
// applies draw/discard/declare actions, runs an idle-turn timer and a deal-over
// pause, and broadcasts public state to the TV plus each player's private hand.

const { RummyGame } = require('./rummy/RummyGame');
const { rosterSlots } = require('./roster');
const config = require('./config');

const TURN_MS = 45_000; // auto-play a stalled seat so the table never hangs
const DEAL_MS = 5_000;  // pause on a finished deal so players can read the result
const MAX_PLAYERS = 6;

function slotInfo(room, slot) {
  for (const p of room.players.values()) {
    if (p.slot === slot) return { name: p.name, color: p.color, connected: true };
  }
  const g = room.grace.get(slot);
  if (g) return { name: g.name, color: g.color, connected: false };
  return { name: slot, color: config.SLOT_COLORS[slot] || '#cccccc', connected: false };
}

function publicState(room) {
  const g = room.rummy;
  const pub = g.publicState();
  pub.players = pub.players.map((p) => ({ ...p, ...slotInfo(room, p.slot) }));
  if (pub.winner) pub.winnerName = slotInfo(room, pub.winner).name;
  if (pub.lastAction && pub.lastAction.slot) {
    pub.lastAction = { ...pub.lastAction, name: slotInfo(room, pub.lastAction.slot).name };
  }
  if (pub.lastDeal && pub.lastDeal.declarer) {
    pub.lastDeal = { ...pub.lastDeal, declarerName: slotInfo(room, pub.lastDeal.declarer).name };
  }
  pub.turnEndsAt = room.rummyTurnEndsAt || null;
  pub.turnMs = TURN_MS;
  return pub;
}

function clearTimers(room) {
  const t = room.rummyTimers;
  if (!t) return;
  if (t.turn) { clearTimeout(t.turn); t.turn = null; }
  if (t.deal) { clearTimeout(t.deal); t.deal = null; }
}

function broadcastAndArm(io, room) {
  const g = room.rummy;
  if (!g) return;
  clearTimers(room);

  const active = g.phase === 'draw' || g.phase === 'discard';
  room.rummyTurnEndsAt = active && g.currentSlot ? Date.now() + TURN_MS : null;

  const pub = publicState(room);
  io.to(room.tvSocketId).emit('rummy_state', pub);
  for (const seat of g.seats) {
    const sid = room.slotOwners[seat];
    if (sid) io.to(sid).emit('rummy_hand', { ...g.handState(seat), state: pub });
  }

  if (g.phase === 'over') {
    io.to(room.code).emit('rummy_over', {
      winner: g.winner,
      winnerName: g.winner ? slotInfo(room, g.winner).name : null,
    });
    stop(room);
    return;
  }

  if (room.rummyTurnEndsAt) {
    room.rummyTimers.turn = setTimeout(() => onTurnTimeout(io, room), TURN_MS);
    if (room.rummyTimers.turn.unref) room.rummyTimers.turn.unref();
  } else if (g.phase === 'dealover') {
    room.rummyTimers.deal = setTimeout(() => onDealTimeout(io, room), DEAL_MS);
    if (room.rummyTimers.deal.unref) room.rummyTimers.deal.unref();
  }
}

function onTurnTimeout(io, room) {
  const g = room.rummy;
  if (!g || (g.phase !== 'draw' && g.phase !== 'discard')) return;
  const slot = g.currentSlot;
  // Auto-play: draw from stock (if needed) then discard the just-drawn card.
  if (g.phase === 'draw') g.draw(slot, 'stock');
  if (g.phase === 'discard') {
    const id = g.drawnCardId || (g.hands[slot][g.hands[slot].length - 1] || {}).id;
    if (id) g.discardCard(slot, id);
  }
  broadcastAndArm(io, room);
}

function onDealTimeout(io, room) {
  const g = room.rummy;
  if (!g) return;
  g.nextDeal();
  broadcastAndArm(io, room);
}

function startRummy(io, room) {
  const slots = rosterSlots(room);
  if (slots.length < config.MIN_PLAYERS_RUMMY) {
    io.to(room.tvSocketId).emit('rummy_error', { message: `Need at least ${config.MIN_PLAYERS_RUMMY} players` });
    return;
  }
  if (slots.length > MAX_PLAYERS) {
    io.to(room.tvSocketId).emit('rummy_error', { message: `Rummy supports up to ${MAX_PLAYERS} players` });
    return;
  }
  room.rummy = new RummyGame(slots);
  room.currentGame = 'rummy';
  room.rummyTimers = { turn: null, deal: null };
  room.rummyTurnEndsAt = null;
  room.rummy.startDeal();
  broadcastAndArm(io, room);
}

function handleRummyAction(io, room, slot, payload = {}) {
  const g = room.rummy;
  if (!g || !g.seats.includes(slot)) return;
  let r;
  switch (payload.action) {
    case 'draw': r = g.draw(slot, payload.source === 'discard' ? 'discard' : 'stock'); break;
    case 'discard': r = g.discardCard(slot, payload.cardId); break;
    case 'declare': r = g.declare(slot, payload.discardId, payload.groups); break;
    default: return;
  }
  if (r && !r.ok) {
    const sid = room.slotOwners[slot];
    if (sid) {
      io.to(sid).emit('rummy_error', { message: r.error });
      io.to(sid).emit('rummy_hand', { ...g.handState(slot), state: publicState(room) });
    }
    return;
  }
  broadcastAndArm(io, room);
}

function resendHand(io, room, slot) {
  const g = room.rummy;
  if (!g || !g.seats.includes(slot)) return;
  const sid = room.slotOwners[slot];
  if (sid) io.to(sid).emit('rummy_hand', { ...g.handState(slot), state: publicState(room) });
}

function handlePlayerLeft(io, room, slot) {
  const g = room.rummy;
  if (!g || !g.seats.includes(slot)) return;
  g.removePlayer(slot);
  broadcastAndArm(io, room);
}

function stop(room) {
  clearTimers(room);
  room.rummy = null;
  room.rummyTurnEndsAt = null;
  if (room.currentGame === 'rummy') room.currentGame = 'penalty';
}

module.exports = { startRummy, handleRummyAction, resendHand, handlePlayerLeft, stop, broadcastAndArm };
