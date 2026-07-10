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

test('assigns exactly one imposter', () => {
  const g = new AmongUsGame(SLOTS, meta);
  const imps = SLOTS.filter((s) => g.players[s].role === 'imposter');
  assert.equal(imps.length, 1);
  assert.equal(g.imposter, imps[0]);
});

test('public state hides names while alive and never leaks roles', () => {
  const g = new AmongUsGame(SLOTS, meta);
  const pub = g.publicState();
  assert.equal(pub.players.length, 4);
  for (const p of pub.players) {
    assert.equal(p.name, null, 'name hidden while alive');
    assert.equal('role' in p, false, 'no role field');
  }
  assert.equal(JSON.stringify(pub).includes('imposter'), false, 'role never serialized');
});

test('step moves a player in the input direction', () => {
  const g = new AmongUsGame(SLOTS, meta);
  const beforeX = g.players.p1.x;
  g.setInputAxis('p1', 'x', 1);
  g.step(0.1);
  assert.ok(g.players.p1.x > beforeX, 'moved right');
});

test('players stay within the map bounds', () => {
  const g = new AmongUsGame(SLOTS, meta);
  g.setInputAxis('p1', 'x', -1);
  g.setInputAxis('p1', 'y', -1);
  for (let i = 0; i < 300; i++) g.step(0.05);
  assert.ok(g.players.p1.x >= g.radius - 0.01 && g.players.p1.x <= MAP.w - g.radius + 0.01);
  assert.ok(g.players.p1.y >= g.radius - 0.01 && g.players.p1.y <= MAP.h - g.radius + 0.01);
});

test('a name is revealed once a player is dead', () => {
  const g = new AmongUsGame(SLOTS, meta);
  g.players.p2.alive = false;
  const p2 = g.publicState().players.find((p) => p.id === 'p2');
  assert.equal(p2.alive, false);
  assert.equal(p2.name, 'Ben');
});
