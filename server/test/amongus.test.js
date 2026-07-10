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
const mk = () => new AmongUsGame(SLOTS, meta, { rng: () => 0 });
const impOf = (g) => g.imposters[0];
const crewOf = (g) => SLOTS.filter((s) => !g.imposters.includes(s));

test('4-6 players get exactly one imposter; 7+ get two (who know each other)', () => {
  assert.equal(mk().imposters.length, 1);
  const big = new AmongUsGame(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], {}, { rng: () => 0 });
  assert.equal(big.imposters.length, 2);
  const [a, b] = big.imposters;
  const ra = big.roleFor(a);
  assert.equal(ra.role, 'imposter');
  assert.equal(ra.teammates.length, 1);
  assert.equal(ra.teammates[0].id, b);
  assert.equal(big.roleFor(crewOf(big)[0]).teammates, undefined);
});

test('public state hides names while alive and never leaks roles', () => {
  const g = mk();
  const pub = g.publicState(1000);
  for (const p of pub.players) { assert.equal(p.name, null); assert.equal('role' in p, false); }
  assert.equal(JSON.stringify(pub).includes('imposter'), false);
});

test('step moves a player; players stay in bounds', () => {
  const g = mk();
  const s = crewOf(g)[0];
  const bx = g.players[s].x;
  g.setInputAxis(s, 'x', 1);
  g.step(0.1);
  assert.ok(g.players[s].x > bx);
  g.setInputAxis(s, 'x', -1);
  for (let i = 0; i < 300; i++) g.step(0.05);
  assert.ok(g.players[s].x >= g.radius - 0.01 && g.players[s].x <= MAP.w - g.radius + 0.01);
});

test('imposter kills a nearby crewmate -> body reveal + meeting', () => {
  const g = mk();
  g.startPlayRound(0);
  const imp = impOf(g);
  const crew = crewOf(g);
  g.players[imp].x = 800; g.players[imp].y = 500;
  g.players[crew[0]].x = 820; g.players[crew[0]].y = 500;
  for (let i = 1; i < crew.length; i++) { g.players[crew[i]].x = 100; g.players[crew[i]].y = 100; }
  assert.equal(g.canKill(imp, 100), false, 'still on cooldown');
  const r = g.tryKill(imp, 20000);
  assert.ok(r.ok);
  assert.equal(g.players[r.victim].role, 'crew');
  assert.equal(g.players[r.victim].alive, false);
  assert.equal(g.phase, 'meeting');
  assert.equal(g.publicState(20000).players.find((p) => p.id === r.victim).name, meta[r.victim].name);
});

test('a crewmate cannot kill and the imposter cannot kill out of range', () => {
  const g = mk();
  g.startPlayRound(0);
  assert.equal(g.canKill(crewOf(g)[0], 20000), false, 'crew never kills');
  const imp = impOf(g);
  g.players[imp].x = 100; g.players[imp].y = 100;
  for (const s of crewOf(g)) { g.players[s].x = 1600; g.players[s].y = 900; }
  assert.equal(g.canKill(imp, 20000), false, 'no target in range');
});

test('venting: imposter enters/moves/exits, vanishes from the shared map; crew cannot vent', () => {
  const g = mk();
  g.startPlayRound(0);
  const imp = impOf(g);
  const v0 = g.map.vents[0];
  g.players[imp].x = v0.x; g.players[imp].y = v0.y;
  assert.equal(g.ventNear(imp), v0.id);
  assert.ok(g.enterVent(imp).ok);
  assert.equal(g.players[imp].vented, true);
  assert.ok(!g.publicState(0).players.find((p) => p.id === imp), 'vented imposter is hidden');
  assert.equal(g.canKill(imp, 20000), false, 'cannot kill while vented');
  assert.equal(g.moveVent(imp, 'v4').ok, false, 'v4 is not adjacent to v1');
  assert.ok(g.moveVent(imp, 'v2').ok, 'v2 is adjacent to v1');
  assert.equal(g.players[imp].x, g.map.vents.find((v) => v.id === 'v2').x);
  assert.ok(g.exitVent(imp).ok);
  assert.equal(g.players[imp].vented, false);

  const crew = crewOf(g)[0];
  g.players[crew].x = v0.x; g.players[crew].y = v0.y;
  assert.equal(g.enterVent(crew).ok, false);
});

test('sabotage: reactor countdown + fix; cooldown; crew cannot sabotage', () => {
  const g = mk();
  g.startPlayRound(0);
  const imp = impOf(g);
  const crew = crewOf(g)[0];
  assert.equal(g.canSabotage(imp, 100), false, 'initial sabotage cooldown');
  assert.ok(g.triggerSabotage(imp, 'reactor', 9000).ok);
  assert.equal(g.sabotage.type, 'reactor');
  assert.equal(g.reactorExpired(9000 + 30000 + 1), true, 'reactor expires if not fixed');
  assert.equal(g.canSabotage(imp, 9500), false, 'on cooldown after triggering');
  assert.equal(g.triggerSabotage(crew, 'lights', 999999).ok, false, 'crew cannot sabotage');

  const st = g.map.sab.reactor;
  g.players[crew].x = st.x; g.players[crew].y = st.y;
  assert.equal(g.fixNear(crew), 'reactor');
  assert.ok(g.fixSabotage(crew).ok);
  assert.equal(g.sabotage, null, 'reactor fixed');

  assert.ok(g.triggerSabotage(imp, 'lights', 40000).ok, 'lights after cooldown');
  assert.equal(g.sabotage.type, 'lights');
  assert.equal(g.reactorExpired(999999), false, 'lights has no timeout');
});

test('voting out the imposter is a crew win; a tie ejects nobody', () => {
  const g = mk();
  const imp = impOf(g);
  g._startMeeting(0, null);
  for (const s of crewOf(g)) g.vote(s, imp);
  g.vote(imp, 'skip');
  const res = g.resolveMeeting(1000);
  assert.equal(res.ejected, imp);
  assert.equal(res.wasImposter, true);
  assert.equal(res.winner, 'crew');

  const g2 = mk();
  g2._startMeeting(0, null);
  g2.vote('p1', 'p2'); g2.vote('p2', 'p1'); g2.vote('p3', 'p4'); g2.vote('p4', 'p3');
  assert.equal(g2.resolveMeeting(1000).ejected, null);
});

test('imposter reaches parity => imposter win', () => {
  const g = mk();
  const crew = crewOf(g);
  g.players[crew[0]].alive = false;
  g.players[crew[1]].alive = false; // 1 imposter vs 1 crew alive
  g._startMeeting(0, null);
  g.vote(impOf(g), 'skip'); g.vote(crew[2], 'skip');
  assert.equal(g.resolveMeeting(1000).winner, 'imposter');
});

test('tasks: only crew tasks count; finishing them all wins for the crew', () => {
  const g = mk();
  g.startPlayRound(0);
  const crew = crewOf(g);
  assert.equal(g.realTaskTotal, crew.reduce((n, s) => n + g.players[s].tasks.length, 0));
  for (const s of crew) {
    for (const t of g.players[s].tasks) {
      const st = g.map.tasks.find((x) => x.id === t.stationId);
      g.players[s].x = st.x; g.players[s].y = st.y;
      assert.ok(g.completeTask(s, t.stationId).ok);
    }
  }
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'crew');
});

test('a task only completes at the station; a ghost can still move', () => {
  const g = mk();
  g.startPlayRound(0);
  const c = crewOf(g)[0];
  g.players[c].x = 0; g.players[c].y = 0;
  assert.equal(g.completeTask(c, g.players[c].tasks[0].stationId).ok, false);
  g.players[c].alive = false;
  const bx = g.players[c].x;
  g.setInputAxis(c, 'x', 1);
  g.step(0.2);
  assert.ok(g.players[c].x > bx);
});
