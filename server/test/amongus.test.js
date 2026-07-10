'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { AmongUsGame } = require('../src/amongus/AmongUsGame');
const { MAP } = require('../src/amongus/map');

const SLOTS = ['p1', 'p2', 'p3', 'p4'];
const meta = {
  p1: { name: 'Ann', color: '#ef4444' }, p2: { name: 'Ben', color: '#3b82f6' },
  p3: { name: 'Cara', color: '#22c55e' }, p4: { name: 'Dan', color: '#eab308' },
};
// rng -> 0 makes slots[0] (p1) the imposter, deterministically.
const mk = () => new AmongUsGame(SLOTS, meta, { rng: () => 0 });

test('assigns exactly one imposter', () => {
  const g = mk();
  assert.equal(g.imposter, 'p1');
  assert.equal(SLOTS.filter((s) => g.players[s].role === 'imposter').length, 1);
});

test('public state hides names while alive and never leaks roles', () => {
  const g = mk();
  const pub = g.publicState(1000);
  for (const p of pub.players) { assert.equal(p.name, null); assert.equal('role' in p, false); }
  assert.equal(JSON.stringify(pub).includes('imposter'), false);
});

test('step moves a player; players stay in bounds', () => {
  const g = mk();
  const bx = g.players.p2.x;
  g.setInputAxis('p2', 'x', 1);
  g.step(0.1);
  assert.ok(g.players.p2.x > bx);
  g.setInputAxis('p2', 'x', -1);
  for (let i = 0; i < 300; i++) g.step(0.05);
  assert.ok(g.players.p2.x >= g.radius - 0.01 && g.players.p2.x <= MAP.w - g.radius + 0.01);
});

test('imposter kills a nearby crewmate, which reveals the body and opens a meeting', () => {
  const g = mk();
  g.startPlayRound(0);          // cooldown = now(0) + 15s
  g.players.p1.x = 800; g.players.p1.y = 500; // imposter
  g.players.p2.x = 820; g.players.p2.y = 500; // crew, in range
  assert.equal(g.canKill('p1', 100), false, 'still on cooldown');
  const r = g.tryKill('p1', 20000);           // past cooldown
  assert.ok(r.ok && r.victim === 'p2');
  assert.equal(g.players.p2.alive, false);
  assert.equal(g.phase, 'meeting');
  const pub = g.publicState(20000);
  assert.equal(pub.players.find((p) => p.id === 'p2').name, 'Ben', 'body name revealed');
});

test('a crewmate cannot kill and the imposter cannot kill out of range', () => {
  const g = mk();
  g.startPlayRound(0);
  assert.equal(g.canKill('p2', 20000), false, 'crew never kills');
  g.players.p1.x = 100; g.players.p1.y = 100;             // imposter
  for (const s of ['p2', 'p3', 'p4']) { g.players[s].x = 1500; g.players[s].y = 900; } // all crew far
  assert.equal(g.canKill('p1', 20000), false, 'no target in range');
});

test('voting ejects the most-voted player and reveals their role; ejecting the imposter = crew win', () => {
  const g = mk();
  g._startMeeting(0, null);
  assert.ok(g.vote('p2', 'p1').ok);
  assert.ok(g.vote('p3', 'p1').ok);
  assert.ok(g.vote('p4', 'p1').ok);
  assert.ok(g.vote('p1', 'skip').ok);
  assert.equal(g.vote('p2', 'p3').ok, false, 'one vote per player');
  const res = g.resolveMeeting(1000);
  assert.equal(res.ejected, 'p1');
  assert.equal(res.wasImposter, true);
  assert.equal(res.winner, 'crew');
  assert.equal(g.phase, 'over');
});

test('a tie ejects nobody', () => {
  const g = mk();
  g._startMeeting(0, null);
  g.vote('p1', 'p2'); g.vote('p2', 'p1'); g.vote('p3', 'p4'); g.vote('p4', 'p3');
  const res = g.resolveMeeting(1000);
  assert.equal(res.ejected, null);
  assert.equal(res.skipped, true);
});

test('imposter reaches parity => imposter win', () => {
  const g = mk();
  // p1 imposter alive; only p2 crew alive (p3,p4 dead) => 1 imp vs 1 crew = parity
  g.players.p3.alive = false;
  g.players.p4.alive = false;
  g._startMeeting(0, null);
  g.vote('p1', 'skip'); g.vote('p2', 'skip');
  const res = g.resolveMeeting(1000);
  assert.equal(res.winner, 'imposter');
  assert.equal(g.phase, 'over');
});

test('tasks are assigned; only crew tasks count toward the bar', () => {
  const g = mk();
  assert.ok(g.players.p2.tasks.length >= 1);
  const expected = ['p2', 'p3', 'p4'].reduce((n, s) => n + g.players[s].tasks.length, 0);
  assert.equal(g.realTaskTotal, expected);
  assert.equal(g.taskProgress(), 0);
});

test('completing all crew tasks wins for the crew', () => {
  const g = mk();
  g.startPlayRound(0);
  for (const s of ['p2', 'p3', 'p4']) {
    for (const t of g.players[s].tasks) {
      const st = g.map.tasks.find((x) => x.id === t.stationId);
      g.players[s].x = st.x; g.players[s].y = st.y;
      assert.ok(g.completeTask(s, t.stationId).ok);
    }
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'crew');
});

test('a task only completes when the player is at the station', () => {
  const g = mk();
  g.startPlayRound(0);
  const t = g.players.p2.tasks[0];
  g.players.p2.x = 0; g.players.p2.y = 0; // far from any station
  assert.equal(g.completeTask('p2', t.stationId).ok, false);
});

test('a dead crewmate (ghost) can still move to finish tasks', () => {
  const g = mk();
  g.startPlayRound(0);
  g.players.p2.alive = false;
  const bx = g.players.p2.x;
  g.setInputAxis('p2', 'x', 1);
  g.step(0.2);
  assert.ok(g.players.p2.x > bx);
});

test('reveal advances back to play after its timer', () => {
  const g = mk();
  g._startMeeting(0, null);
  g.vote('p2', 'p3'); g.vote('p1', 'p3'); g.vote('p3', 'skip'); g.vote('p4', 'p3'); // eject p3 (crew), no win
  g.resolveMeeting(1000);
  assert.equal(g.phase, 'reveal');
  assert.equal(g.revealDone(1000 + 4500 + 1), true);
  g.startPlayRound(999999);
  assert.equal(g.phase, 'play');
});
