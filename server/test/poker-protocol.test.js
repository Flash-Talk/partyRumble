'use strict';

// Socket-level smoke test for the poker wiring (start_poker -> poker_state +
// per-player poker_hole; poker_action advances public state). The betting logic
// itself is covered exhaustively in poker.test.js.

const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../index');
const { io: Client } = require('socket.io-client');

function startServer() {
  const ctx = createServer();
  return new Promise((resolve) => {
    ctx.httpServer.listen(0, () => resolve({ ...ctx, port: ctx.httpServer.address().port }));
  });
}
const stopServer = (ctx) => new Promise((r) => ctx.io.close(() => r()));
const connect = (port) => Client(`http://localhost:${port}`, { forceNew: true, transports: ['websocket'], reconnection: false });
const once = (sock, event) => new Promise((resolve) => sock.once(event, resolve));

async function makeTvWithRoom(port) {
  const tv = connect(port);
  await once(tv, 'connect');
  tv.emit('create_room');
  const { roomCode } = await once(tv, 'room_created');
  return { tv, roomCode };
}
async function joinPlayer(port, roomCode, name) {
  const p = connect(port);
  await once(p, 'connect');
  p.emit('join_room', { roomCode, playerName: name });
  await once(p, 'join_success');
  return p;
}

test('poker: start deals holes to phones + public state to TV, and a fold advances the hand', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const { tv, roomCode } = await makeTvWithRoom(ctx.port);
  t.after(() => tv.close());

  const p1 = await joinPlayer(ctx.port, roomCode, 'Ann');
  const p2 = await joinPlayer(ctx.port, roomCode, 'Bob');
  t.after(() => { p1.close(); p2.close(); });

  const tvState = once(tv, 'poker_state');
  const h1 = once(p1, 'poker_hole');
  const h2 = once(p2, 'poker_hole');
  tv.emit('start_poker');

  const [st, hole1, hole2] = await Promise.all([tvState, h1, h2]);
  assert.equal(st.street, 'preflop');
  assert.equal(st.players.length, 2);
  assert.equal(hole1.hole.length, 2, 'p1 gets two hole cards');
  assert.equal(hole2.hole.length, 2, 'p2 gets two hole cards');
  assert.ok(st.toAct === 'player_1' || st.toAct === 'player_2');

  // The player on the clock folds heads-up -> the other wins the pot uncontested.
  const actor = st.toAct;
  const sock = actor === 'player_1' ? p1 : p2;
  const next = once(tv, 'poker_state');
  sock.emit('poker_action', { action: 'fold' });

  const st2 = await next;
  assert.equal(st2.street, 'handover');
  assert.ok(st2.handResult, 'a hand result is reported');
  assert.ok(st2.handResult.winners.length >= 1);
});
