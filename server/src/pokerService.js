'use strict';

// Glue between socket.io and the authoritative PokerGame: starts the tournament,
// applies player actions, drives two timers (a 30s turn clock that auto-checks/
// folds an idle seat, and a ~4s pause between hands), and broadcasts public state
// to the TV plus each player's private hole cards to their own socket.

const { PokerGame } = require('./poker/PokerGame');
const config = require('./config');

const TURN_MS = 30_000; // auto-act after this so an idle phone never stalls the table
const HAND_MS = 4_000;  // pause on a finished hand so players can read the result

function slotInfo(room, slot) {
  for (const p of room.players.values()) {
    if (p.slot === slot) return { name: p.name, color: p.color, connected: true };
  }
  const g = room.grace.get(slot);
  if (g) return { name: g.name, color: g.color, connected: false };
  return { name: slot, color: config.SLOT_COLORS[slot] || '#cccccc', connected: false };
}

function publicState(room) {
  const g = room.poker;
  const pub = g.publicState();
  pub.players = pub.players.map((p) => ({ ...p, ...slotInfo(room, p.slot) }));
  if (pub.winner) pub.winnerName = slotInfo(room, pub.winner).name;
  if (pub.lastAction && pub.lastAction.slot) {
    pub.lastAction = { ...pub.lastAction, name: slotInfo(room, pub.lastAction.slot).name };
  }
  if (pub.handResult && pub.handResult.winners) {
    pub.handResult = {
      ...pub.handResult,
      winners: pub.handResult.winners.map((w) => ({ ...w, name: slotInfo(room, w.slot).name })),
    };
  }
  pub.turnEndsAt = room.pokerTurnEndsAt || null;
  pub.turnMs = TURN_MS;
  return pub;
}

function clearTimers(room) {
  const t = room.pokerTimers;
  if (!t) return;
  if (t.turn) { clearTimeout(t.turn); t.turn = null; }
  if (t.hand) { clearTimeout(t.hand); t.hand = null; }
}

function broadcastAndArm(io, room) {
  const g = room.poker;
  if (!g) return;
  clearTimers(room);

  // A turn is live only while someone is on the clock in a betting round.
  room.pokerTurnEndsAt = (g.phase === 'playing' && g.toAct) ? Date.now() + TURN_MS : null;

  const pub = publicState(room);
  io.to(room.tvSocketId).emit('poker_state', pub);
  for (const seat of g.seats) {
    const sid = room.slotOwners[seat];
    if (sid) io.to(sid).emit('poker_hole', { ...g.holeState(seat), state: pub });
  }

  if (g.phase === 'over') {
    io.to(room.code).emit('poker_over', {
      winner: g.winner,
      winnerName: g.winner ? slotInfo(room, g.winner).name : null,
    });
    stop(room);
    return;
  }

  if (room.pokerTurnEndsAt) {
    room.pokerTimers.turn = setTimeout(() => onTurnTimeout(io, room), TURN_MS);
    if (room.pokerTimers.turn.unref) room.pokerTimers.turn.unref();
  } else if (g.street === 'handover') {
    room.pokerTimers.hand = setTimeout(() => onHandTimeout(io, room), HAND_MS);
    if (room.pokerTimers.hand.unref) room.pokerTimers.hand.unref();
  }
}

function onTurnTimeout(io, room) {
  const g = room.poker;
  if (!g || g.phase !== 'playing') return;
  const slot = g.toAct;
  if (!slot) return;
  const la = g.legalActions(slot);
  g.act(slot, la.canCheck ? 'check' : 'fold');
  broadcastAndArm(io, room);
}

function onHandTimeout(io, room) {
  const g = room.poker;
  if (!g) return;
  if (g.phase === 'over') { broadcastAndArm(io, room); return; }
  g.startHand();
  broadcastAndArm(io, room);
}

function startPoker(io, room) {
  const slots = Object.keys(room.slotOwners).sort();
  if (slots.length < config.MIN_PLAYERS_POKER) {
    io.to(room.tvSocketId).emit('poker_error', { message: `Need at least ${config.MIN_PLAYERS_POKER} players` });
    return;
  }
  room.poker = new PokerGame(slots);
  room.currentGame = 'poker';
  room.pokerTimers = { turn: null, hand: null };
  room.pokerTurnEndsAt = null;
  room.poker.startHand();
  broadcastAndArm(io, room);
}

function handlePokerAction(io, room, slot, payload = {}) {
  const g = room.poker;
  if (!g || !g.seats.includes(slot)) return;
  const r = g.act(slot, payload.action, payload.amount);
  if (r && !r.ok) {
    const sid = room.slotOwners[slot];
    if (sid) {
      io.to(sid).emit('poker_error', { message: r.error });
      io.to(sid).emit('poker_hole', { ...g.holeState(slot), state: publicState(room) });
    }
    return;
  }
  broadcastAndArm(io, room);
}

// Re-send one player's hole cards (used on reconnect / mid-round join).
function resendHole(io, room, slot) {
  const g = room.poker;
  if (!g || !g.seats.includes(slot)) return;
  const sid = room.slotOwners[slot];
  if (sid) io.to(sid).emit('poker_hole', { ...g.holeState(slot), state: publicState(room) });
}

function handlePlayerLeft(io, room, slot) {
  const g = room.poker;
  if (!g || !g.seats.includes(slot)) return;
  g.removePlayer(slot);
  broadcastAndArm(io, room);
}

function stop(room) {
  clearTimers(room);
  room.poker = null;
  room.pokerTurnEndsAt = null;
  if (room.currentGame === 'poker') room.currentGame = 'penalty';
}

module.exports = { startPoker, handlePokerAction, resendHole, handlePlayerLeft, stop, broadcastAndArm };
