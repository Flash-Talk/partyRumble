'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  cardPoints, isJoker, isValidSequence, isValidSet, validateDeclaration, minDeadwood,
} = require('../src/rummy/melds');

let _id = 0;
const c = (rank, suit) => ({ id: `t${_id++}`, rank, suit });
const jk = () => ({ id: `j${_id++}`, joker: true });

// ---- points & jokers ----

test('card points: face/ace = 10, numbers face value, jokers 0', () => {
  assert.equal(cardPoints(c('K', 's'), '10'), 10);
  assert.equal(cardPoints(c('A', 'h'), '10'), 10);
  assert.equal(cardPoints(c('7', 'd'), '10'), 7);
  assert.equal(cardPoints(jk(), '10'), 0);
  assert.equal(cardPoints(c('9', 'c'), '9'), 0, 'a wild-rank card is worth 0');
});

test('isJoker: printed and wild-rank', () => {
  assert.equal(isJoker(jk(), '5'), true);
  assert.equal(isJoker(c('5', 'h'), '5'), true);
  assert.equal(isJoker(c('6', 'h'), '5'), false);
});

// ---- sequences ----

test('pure run of same suit', () => {
  const r = isValidSequence([c('4', 's'), c('5', 's'), c('6', 's')], '10');
  assert.deepEqual(r, { valid: true, pure: true });
});

test('impure run with a printed joker filling the gap', () => {
  const r = isValidSequence([c('4', 's'), c('6', 's'), jk()], '10');
  assert.equal(r.valid, true);
  assert.equal(r.pure, false);
});

test('a wild-rank card used at its natural place is still pure', () => {
  const r = isValidSequence([c('4', 's'), c('5', 's'), c('6', 's')], '5');
  assert.equal(r.valid, true);
  assert.equal(r.pure, true);
});

test('a wild-rank card can also fill a gap as a joker (impure)', () => {
  // wild = 9: the 9s stands in for the missing 5 → 4,_,6
  const r = isValidSequence([c('4', 's'), c('6', 's'), c('9', 's')], '9');
  assert.equal(r.valid, true);
  assert.equal(r.pure, false);
});

test('ace low and ace high runs, but no wrap-around', () => {
  assert.equal(isValidSequence([c('A', 's'), c('2', 's'), c('3', 's')], '10').valid, true);
  assert.equal(isValidSequence([c('Q', 's'), c('K', 's'), c('A', 's')], '10').valid, true);
  assert.equal(isValidSequence([c('K', 's'), c('A', 's'), c('2', 's')], '10').valid, false);
});

test('mixed suits is not a sequence', () => {
  assert.equal(isValidSequence([c('4', 's'), c('5', 'h'), c('6', 's')], '10').valid, false);
});

// ---- sets ----

test('valid set: same rank, distinct suits', () => {
  assert.equal(isValidSet([c('7', 's'), c('7', 'h'), c('7', 'd')], '10'), true);
});

test('set with a joker filling a suit', () => {
  assert.equal(isValidSet([c('7', 's'), c('7', 'h'), jk()], '10'), true);
});

test('duplicate suit is not a set', () => {
  assert.equal(isValidSet([c('7', 's'), c('7', 's'), c('7', 'h')], '10'), false);
});

test('a run is not accepted as a set', () => {
  assert.equal(isValidSet([c('4', 's'), c('5', 's'), c('6', 's')], '10'), false);
});

// ---- declaration ----

function fullValidHand() {
  // 3 + 3 + 3 + 4 = 13, two pure sequences + two sets
  return [
    [c('4', 's'), c('5', 's'), c('6', 's')],          // pure seq
    [c('7', 'h'), c('8', 'h'), c('9', 'h')],          // pure seq
    [c('K', 'c'), c('K', 'd'), c('K', 'h')],          // set
    [c('2', 's'), c('2', 'd'), c('2', 'c'), c('2', 'h')], // set (4)
  ];
}

test('valid declaration: 2 sequences (1 pure) covering all 13', () => {
  const r = validateDeclaration(fullValidHand(), '10');
  assert.equal(r.valid, true);
});

test('declaration rejected without a pure sequence', () => {
  const groups = [
    [c('4', 's'), c('6', 's'), jk()],                 // impure seq
    [c('7', 'h'), c('9', 'h'), jk()],                 // impure seq
    [c('K', 'c'), c('K', 'd'), c('K', 'h')],
    [c('2', 's'), c('2', 'd'), c('2', 'c'), c('2', 'h')],
  ];
  const r = validateDeclaration(groups, '10');
  assert.equal(r.valid, false);
  assert.match(r.reason, /pure/i);
});

test('declaration rejected with fewer than two sequences', () => {
  const groups = [
    [c('4', 's'), c('5', 's'), c('6', 's')],          // one seq only
    [c('K', 'c'), c('K', 'd'), c('K', 'h')],
    [c('2', 's'), c('2', 'd'), c('2', 'c')],
    [c('9', 's'), c('9', 'd'), c('9', 'h'), c('9', 'c')],
  ];
  const r = validateDeclaration(groups, '10');
  assert.equal(r.valid, false);
  assert.match(r.reason, /two sequences/i);
});

test('declaration rejected when not all 13 cards are used', () => {
  const groups = fullValidHand();
  groups[3].pop(); // now only 12 cards
  const r = validateDeclaration(groups, '10');
  assert.equal(r.valid, false);
});

// ---- deadwood solver ----

test('a fully-melded hand scores 0 deadwood', () => {
  const hand = fullValidHand().flat();
  assert.equal(minDeadwood(hand, '10'), 0);
});

test('no pure sequence → full count, capped at 80', () => {
  const hand = [
    c('A', 's'), c('2', 'h'), c('3', 'd'), c('4', 'c'), c('5', 's'), c('6', 'h'), c('7', 'd'),
    c('8', 'c'), c('9', 's'), c('10', 'h'), c('J', 'd'), c('Q', 'c'), c('K', 's'),
  ]; // 13 distinct ranks, cycled suits — no run, no set. Sum of points = 94.
  assert.equal(minDeadwood(hand, '9'), 80);
});

test('with only one sequence, a set does not count toward melds', () => {
  const hand = [
    c('4', 's'), c('5', 's'), c('6', 's'),            // pure seq (counts)
    c('K', 'c'), c('K', 'd'), c('K', 'h'),            // set — NOT counted (only 1 seq)
    c('2', 'h'), c('8', 'd'), c('2', 'c'), c('9', 'h'), c('3', 'd'), c('8', 'c'), c('10', 'd'),
  ];
  // deadwood = KKK (30) + loose (2+8+2+9+3+8+10 = 42) = 72
  assert.equal(minDeadwood(hand, 'Q'), 72);
});

test('two sequences let a set count, leaving only loose cards as deadwood', () => {
  const hand = [
    c('4', 's'), c('5', 's'), c('6', 's'),            // pure seq
    c('7', 'h'), c('8', 'h'), c('9', 'h'),            // pure seq
    c('K', 'c'), c('K', 'd'), c('K', 'h'),            // set (now counts)
    c('2', 'd'), c('2', 'c'), c('3', 'c'), c('10', 'd'), // loose = 2+2+3+10 = 17
  ];
  assert.equal(minDeadwood(hand, 'Q'), 17);
});
