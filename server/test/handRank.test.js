'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { evaluateSeven, compareHands, CATEGORY } = require('../src/poker/handRank');

// Terse card builder: h('As','Kd','2c', ...) -> [{rank,suit}, ...]
function h(...codes) {
  return codes.map((code) => {
    const suit = code.slice(-1);
    const rank = code.slice(0, -1);
    return { id: code, rank, suit };
  });
}
const ev = (...codes) => evaluateSeven(h(...codes));

// ---- category detection ----

test('royal / ace-high straight flush', () => {
  const r = ev('As', 'Ks', 'Qs', 'Js', '10s', '2h', '3d');
  assert.equal(r.category, CATEGORY.STRAIGHT_FLUSH);
  assert.deepEqual(r.ranks, [14]);
});

test('wheel straight flush (A-2-3-4-5) ranks as 5-high', () => {
  const r = ev('5s', '4s', '3s', '2s', 'As', 'Kh', 'Qd');
  assert.equal(r.category, CATEGORY.STRAIGHT_FLUSH);
  assert.deepEqual(r.ranks, [5]);
});

test('four of a kind with kicker', () => {
  const r = ev('Ah', 'Ad', 'As', 'Ac', 'Kh', '2d', '3c');
  assert.equal(r.category, CATEGORY.FOUR_KIND);
  assert.deepEqual(r.ranks, [14, 13]);
});

test('full house from trips + pair', () => {
  const r = ev('Kh', 'Kd', 'Ks', 'Qh', 'Qd', '2c', '3s');
  assert.equal(r.category, CATEGORY.FULL_HOUSE);
  assert.deepEqual(r.ranks, [13, 12]);
});

test('full house from two trips uses higher as the trip', () => {
  const r = ev('Kh', 'Kd', 'Ks', 'Qh', 'Qd', 'Qc', '2s');
  assert.equal(r.category, CATEGORY.FULL_HOUSE);
  assert.deepEqual(r.ranks, [13, 12]);
});

test('flush takes the top five of the suit', () => {
  const r = ev('As', '9s', '7s', '4s', '2s', 'Kd', 'Qd');
  assert.equal(r.category, CATEGORY.FLUSH);
  assert.deepEqual(r.ranks, [14, 9, 7, 4, 2]);
});

test('straight (mixed suits)', () => {
  const r = ev('9h', '8d', '7s', '6c', '5h', 'Ah', 'Kd');
  assert.equal(r.category, CATEGORY.STRAIGHT);
  assert.deepEqual(r.ranks, [9]);
});

test('ace-high straight', () => {
  const r = ev('Ah', 'Kd', 'Qs', 'Jc', '10h', '3d', '2s');
  assert.equal(r.category, CATEGORY.STRAIGHT);
  assert.deepEqual(r.ranks, [14]);
});

test('wheel straight (mixed) ranks as 5-high', () => {
  const r = ev('Ah', '2d', '3s', '4c', '5h', 'Kd', 'Qs');
  assert.equal(r.category, CATEGORY.STRAIGHT);
  assert.deepEqual(r.ranks, [5]);
});

test('three of a kind with two kickers', () => {
  const r = ev('8h', '8d', '8s', 'Kh', 'Qd', '2c', '3s');
  assert.equal(r.category, CATEGORY.THREE_KIND);
  assert.deepEqual(r.ranks, [8, 13, 12]);
});

test('two pair takes the best two pairs + kicker', () => {
  const r = ev('Kh', 'Kd', 'Qh', 'Qd', 'Jh', 'Jd', '2s');
  assert.equal(r.category, CATEGORY.TWO_PAIR);
  assert.deepEqual(r.ranks, [13, 12, 11]); // third pair's card is the kicker
});

test('one pair with three kickers', () => {
  const r = ev('9h', '9d', 'Ah', 'Kd', 'Qc', '2s', '3h');
  assert.equal(r.category, CATEGORY.ONE_PAIR);
  assert.deepEqual(r.ranks, [9, 14, 13, 12]);
});

test('high card takes the top five', () => {
  const r = ev('Ah', 'Kd', '9s', '7c', '5h', '3d', '2s');
  assert.equal(r.category, CATEGORY.HIGH_CARD);
  assert.deepEqual(r.ranks, [14, 13, 9, 7, 5]);
});

// ---- comparisons ----

test('higher category wins', () => {
  const flush = ev('As', '9s', '7s', '4s', '2s', 'Kd', 'Qd');
  const straight = ev('9h', '8d', '7s', '6c', '5h', 'Ah', 'Kd');
  assert.equal(compareHands(flush, straight), 1);
  assert.equal(compareHands(straight, flush), -1);
});

test('same category breaks on ranks', () => {
  const aces = ev('Ah', 'Ad', '5s', '7c', '9h', '2d', '3s');
  const kings = ev('Kh', 'Kd', '5s', '7c', '9h', '2d', '3s');
  assert.equal(compareHands(aces, kings), 1);
});

test('kicker decides equal pairs', () => {
  const aceKick = ev('Kh', 'Kd', 'As', '7c', '4h', '2d', '3s');
  const queenKick = ev('Kh', 'Kd', 'Qs', '7c', '4h', '2d', '3s');
  assert.equal(compareHands(aceKick, queenKick), 1);
});

test('identical hands tie', () => {
  const a = ev('Kh', 'Kd', 'As', '7c', '4h', '2d', '3s');
  const b = ev('Ks', 'Kc', 'Ah', '7d', '4s', '2h', '3d');
  assert.equal(compareHands(a, b), 0);
});
