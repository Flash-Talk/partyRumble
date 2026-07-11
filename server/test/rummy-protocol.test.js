'use strict';

// Socket-level smoke test for the rummy wiring (start_rummy -> rummy_state +
// per-player rummy_hand; rummy_action draw/discard advances state). The engine
// itself is covered in rummy.test.js and melds.test.js.

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

test('rummy: start deals 13 to each phone + public state to TV, and draw/discard advances the turn', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const { tv, roomCode } = await makeTvWithRoom(ctx.port);
  t.after(() => tv.close());

  const p1 = await joinPlayer(ctx.port, roomCode, 'Ann');
  const p2 = await joinPlayer(ctx.port, roomCode, 'Bob');
  t.after(() => { p1.close(); p2.close(); });

  const tvState = once(tv, 'rummy_state');
  const h1 = once(p1, 'rummy_hand');
  const h2 = once(p2, 'rummy_hand');
  tv.emit('start_rummy');

  const [st, hand1, hand2] = await Promise.all([tvState, h1, h2]);
  assert.equal(st.players.length, 2);
  assert.ok(st.wildRank, 'a wild joker rank is set');
  assert.equal(hand1.cards.length, 13);
  assert.equal(hand2.cards.length, 13);
  assert.ok(st.turn === 'player_1' || st.turn === 'player_2');

  // The player on turn draws from the stock, then discards a card.
  const actor = st.turn;
  const sock = actor === 'player_1' ? p1 : p2;
  const hand = actor === 'player_1' ? hand1 : hand2;

  const afterDraw = once(sock, 'rummy_hand');
  sock.emit('rummy_action', { action: 'draw', source: 'stock' });
  const drew = await afterDraw;
  assert.equal(drew.cards.length, 14, 'hand grows to 14 after a draw');

  const tvAfter = once(tv, 'rummy_state');
  sock.emit('rummy_action', { action: 'discard', cardId: drew.cards[0].id });
  const st2 = await tvAfter;
  assert.notEqual(st2.turn, actor, 'turn passes to the other player after a discard');
});
