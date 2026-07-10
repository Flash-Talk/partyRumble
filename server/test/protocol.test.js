'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../index');
const { io: Client } = require('socket.io-client');

// ---- helpers ---------------------------------------------------------------

function startServer(overrides) {
  const ctx = createServer(overrides);
  return new Promise((resolve) => {
    ctx.httpServer.listen(0, () => resolve({ ...ctx, port: ctx.httpServer.address().port }));
  });
}

function stopServer(ctx) {
  // io.close() disconnects every socket AND closes the underlying http server,
  // so teardown never blocks waiting on live connections.
  return new Promise((resolve) => ctx.io.close(() => resolve()));
}

function connect(port) {
  return Client(`http://localhost:${port}`, {
    forceNew: true,
    transports: ['websocket'],
    reconnection: false, // don't keep the test process alive retrying
  });
}

function once(sock, event) {
  return new Promise((resolve) => sock.once(event, resolve));
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves true if `event` fires within `ms`, else false (used to assert absence).
function firesWithin(sock, event, ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    sock.once(event, () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function makeTvWithRoom(port) {
  const tv = connect(port);
  await once(tv, 'connect');
  tv.emit('create_room');
  const { roomCode } = await once(tv, 'room_created');
  return { tv, roomCode };
}

async function joinPlayer(port, roomCode, playerName) {
  const p = connect(port);
  await once(p, 'connect');
  p.emit('join_room', { roomCode, playerName });
  return p;
}

// ---- tests -----------------------------------------------------------------

test('create_room returns a 4-letter alphabetic code', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  const { tv, roomCode } = await makeTvWithRoom(ctx.port);
  t.after(() => tv.close());

  assert.match(roomCode, /^[A-Z]{4}$/, 'code should be 4 uppercase letters');
});

test('player join assigns slot + color and notifies the TV', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const { tv, roomCode } = await makeTvWithRoom(ctx.port);
  t.after(() => tv.close());

  const p1 = connect(ctx.port);
  t.after(() => p1.close());
  await once(p1, 'connect');

  const tvHeard = once(tv, 'player_joined');
  p1.emit('join_room', { roomCode, playerName: 'Ann' });

  const success = await once(p1, 'join_success');
  assert.equal(success.slot, 'player_1');
  assert.equal(success.color, '#ef4444');

  const joined = await tvHeard;
  assert.deepEqual(
    { slot: joined.slot, name: joined.name, color: joined.color },
    { slot: 'player_1', name: 'Ann', color: '#ef4444' },
  );
});

test('controller_input is relayed to the TV as game_input with the slot', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const { tv, roomCode } = await makeTvWithRoom(ctx.port);
  t.after(() => tv.close());

  const p1 = await joinPlayer(ctx.port, roomCode, 'Ann');
  t.after(() => p1.close());
  await once(p1, 'join_success');

  const relayed = once(tv, 'game_input');
  p1.emit('controller_input', { type: 'AXIS', id: 'x', value: 0.5 });

  const msg = await relayed;
  assert.deepEqual(msg, { slot: 'player_1', type: 'AXIS', id: 'x', value: 0.5 });
});

test('slots are handed out in order up to 8 and a 9th player is rejected as full', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));
  const { tv, roomCode } = await makeTvWithRoom(ctx.port);
  t.after(() => tv.close());

  for (let i = 0; i < 8; i++) {
    const p = await joinPlayer(ctx.port, roomCode, `P${i + 1}`);
    t.after(() => p.close());
    const ok = await once(p, 'join_success');
    assert.equal(ok.slot, `player_${i + 1}`);
  }

  const ninth = await joinPlayer(ctx.port, roomCode, 'Late');
  t.after(() => ninth.close());
  const err = await once(ninth, 'room_error');
  assert.equal(err.message, 'Room is full');
});

test('joining a non-existent room errors', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  const p = await joinPlayer(ctx.port, 'ZZZZ', 'Nobody');
  t.after(() => p.close());
  const err = await once(p, 'room_error');
  assert.equal(err.message, 'Room not found');
});

test('reconnect within the grace window reclaims the same slot; TV gets no player_left', async (t) => {
  const ctx = await startServer({ DISCONNECT_GRACE_MS: 400 });
  t.after(() => stopServer(ctx));
  const { tv, roomCode } = await makeTvWithRoom(ctx.port);
  t.after(() => tv.close());

  const p1 = await joinPlayer(ctx.port, roomCode, 'Ann');
  const first = await once(p1, 'join_success');
  assert.equal(first.slot, 'player_1');

  // Drop the socket, then reconnect (same name) before grace expires.
  const noLeft = firesWithin(tv, 'player_left', 300);
  p1.close();

  const p1b = await joinPlayer(ctx.port, roomCode, 'Ann');
  t.after(() => p1b.close());
  const again = await once(p1b, 'join_success');
  assert.equal(again.slot, 'player_1', 'same slot reclaimed');
  assert.equal(again.color, '#ef4444', 'same color reclaimed');
  assert.equal(await noLeft, false, 'TV must not receive player_left during grace');
});

test('slot is freed (player_left) after the grace window expires', async (t) => {
  const ctx = await startServer({ DISCONNECT_GRACE_MS: 150 });
  t.after(() => stopServer(ctx));
  const { tv, roomCode } = await makeTvWithRoom(ctx.port);
  t.after(() => tv.close());

  const p1 = await joinPlayer(ctx.port, roomCode, 'Ann');
  await once(p1, 'join_success');

  const left = once(tv, 'player_left');
  p1.close();

  const msg = await left;
  assert.equal(msg.slot, 'player_1');
});

test('TV reconnect with the host token reclaims the same room and roster', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  const tv = connect(ctx.port);
  t.after(() => tv.close());
  await once(tv, 'connect');
  tv.emit('create_room', { token: 'host-abc' });
  const { roomCode } = await once(tv, 'room_created');

  const p1 = await joinPlayer(ctx.port, roomCode, 'Ann');
  t.after(() => p1.close());
  await once(p1, 'join_success');

  // Host drops; a fresh socket resumes with the same token + code.
  tv.close();
  const tv2 = connect(ctx.port);
  t.after(() => tv2.close());
  await once(tv2, 'connect');
  const roster = [];
  tv2.on('player_joined', (m) => roster.push(m));
  tv2.emit('create_room', { token: 'host-abc', roomCode });

  const rc = await once(tv2, 'room_created');
  assert.equal(rc.roomCode, roomCode, 'same room code');
  assert.equal(rc.resumed, true);

  await delay(80);
  assert.ok(roster.some((m) => m.slot === 'player_1' && m.name === 'Ann'),
    'roster replayed to the reconnected host');

  // Input now relays to the NEW TV socket.
  const relayed = once(tv2, 'game_input');
  p1.emit('controller_input', { type: 'BUTTON', id: 'shoot', value: true });
  const g = await relayed;
  assert.equal(g.slot, 'player_1');
});

test('resume with the wrong token does NOT hijack a room (a new room is made)', async (t) => {
  const ctx = await startServer();
  t.after(() => stopServer(ctx));

  const tv = connect(ctx.port);
  t.after(() => tv.close());
  await once(tv, 'connect');
  tv.emit('create_room', { token: 'real-token' });
  const { roomCode } = await once(tv, 'room_created');

  const impostor = connect(ctx.port);
  t.after(() => impostor.close());
  await once(impostor, 'connect');
  impostor.emit('create_room', { token: 'wrong-token', roomCode });
  const rc = await once(impostor, 'room_created');
  assert.notEqual(rc.roomCode, roomCode, 'impostor gets its own new room');
  assert.notEqual(rc.resumed, true);
});
