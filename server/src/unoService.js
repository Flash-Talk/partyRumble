'use strict';

// Glue between socket.io and the authoritative UnoGame: starts rounds, applies
// player actions, and broadcasts public state to the TV + each player's private
// hand to their own socket.

const { UnoGame } = require('./uno/UnoGame');
const { rosterSlots } = require('./roster');
const config = require('./config');

function slotInfo(room, slot) {
  for (const p of room.players.values()) {
    if (p.slot === slot) return { name: p.name, color: p.color, connected: true };
  }
  const g = room.grace.get(slot);
  if (g) return { name: g.name, color: g.color, connected: false };
  return { name: slot, color: config.SLOT_COLORS[slot] || '#cccccc', connected: false };
}

function publicState(room) {
  const g = room.unoGame;
  const pub = g.publicState();
  pub.players = pub.players.map((p) => ({ ...p, ...slotInfo(room, p.slot) }));
  if (pub.winner) pub.winnerName = slotInfo(room, pub.winner).name;
  if (pub.lastAction && pub.lastAction.slot) {
    pub.lastAction = { ...pub.lastAction, name: slotInfo(room, pub.lastAction.slot).name };
  }
  return pub;
}

function broadcastUno(io, room) {
  const g = room.unoGame;
  if (!g) return;
  const pub = publicState(room);

  io.to(room.tvSocketId).emit('uno_state', pub);
  for (const slot of g.slots) {
    const sid = room.slotOwners[slot];
    if (sid) io.to(sid).emit('uno_hand', { ...g.handState(slot), state: pub });
  }

  if (g.phase === 'over') {
    io.to(room.code).emit('uno_over', {
      winner: g.winner,
      winnerName: g.winner ? slotInfo(room, g.winner).name : null,
    });
    room.unoGame = null;
    room.currentGame = 'penalty';
  }
}

function startUno(io, room) {
  const slots = rosterSlots(room);
  if (slots.length < config.MIN_PLAYERS_UNO) {
    io.to(room.tvSocketId).emit('uno_error', { message: 'Need at least 2 players' });
    return;
  }
  room.unoGame = new UnoGame(slots);
  room.currentGame = 'uno';
  broadcastUno(io, room);
}

function handleUnoAction(io, room, slot, payload = {}) {
  const g = room.unoGame;
  if (!g || !g.slots.includes(slot)) return;

  let r;
  switch (payload.action) {
    case 'play': r = g.play(slot, payload.cardId, payload.color); break;
    case 'draw': r = g.draw(slot); break;
    case 'pass': r = g.pass(slot); break;
    case 'uno': r = g.callUno(slot); break;
    default: return;
  }

  if (r && !r.ok) {
    const sid = room.slotOwners[slot];
    if (sid) {
      io.to(sid).emit('uno_error', { message: r.error });
      io.to(sid).emit('uno_hand', { ...g.handState(slot), state: publicState(room) });
    }
    return;
  }
  broadcastUno(io, room);
}

// Re-send one player's hand (used on reconnect / mid-round join).
function resendHand(io, room, slot) {
  const g = room.unoGame;
  if (!g || !g.slots.includes(slot)) return;
  const sid = room.slotOwners[slot];
  if (sid) io.to(sid).emit('uno_hand', { ...g.handState(slot), state: publicState(room) });
}

function handlePlayerLeftUno(io, room, slot) {
  const g = room.unoGame;
  if (!g || !g.slots.includes(slot)) return;
  g.removePlayer(slot);
  broadcastUno(io, room);
}

module.exports = { startUno, handleUnoAction, resendHand, handlePlayerLeftUno, broadcastUno };
