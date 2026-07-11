'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { RummyGame } = require('../src/rummy/RummyGame');

let _id = 0;
const c = (rank, suit) => ({ id: `t${_id++}`, rank, suit });
const ids = (arr) => arr.map((x) => x.id);

// A valid 13-card arrangement: 2 pure sequences + 2 sets, returned as flat cards
// plus the grouped id-lists for a declaration.
function validThirteen() {
  const g1 = [c('4', 's'), c('5', 's'), c('6', 's')];
  const g2 = [c('7', 'h'), c('8', 'h'), c('9', 'h')];
  const g3 = [c('K', 'c'), c('K', 'd'), c('K', 'h')];
  const g4 = [c('3', 's'), c('3', 'd'), c('3', 'c'), c('3', 'h')];
  return { cards: [...g1, ...g2, ...g3, ...g4], groups: [ids(g1), ids(g2), ids(g3), ids(g4)] };
}

// 13 cards with no meld at all (full count = 80 when scored).
function noMeldThirteen() {
  return [
    c('A', 's'), c('2', 'h'), c('3', 'd'), c('4', 'c'), c('5', 's'), c('6', 'h'), c('7', 'd'),
    c('8', 'c'), c('9', 's'), c('10', 'h'), c('J', 'd'), c('Q', 'c'), c('K', 's'),
  ];
}

// ---- deal ----

test('a fresh deal gives 13 cards each and picks a wild-joker rank', () => {
  const g = new RummyGame(['a', 'b', 'c', 'd']);
  g.startDeal();
  for (const s of ['a', 'b', 'c', 'd']) assert.equal(g.hands[s].length, 13);
  assert.equal(g.discard.length, 1);
  assert.ok(g.wildRank, 'a wild rank is chosen');
  // 2 decks + 2 jokers = 106; 52 dealt, 1 wild, 1 discard → 52 in the stock.
  assert.equal(g.stock.length, 106 - 52 - 1 - 1);
  assert.equal(g.phase, 'draw');
});

// ---- draw / discard turn flow ----

function twoPlayerDrawGame() {
  const aHand = validThirteen().cards;
  const bHand = noMeldThirteen();
  return new RummyGame(['a', 'b'], {
    testState: {
      hands: { a: aHand, b: bHand },
      stock: [c('2', 'd'), c('5', 'c')],
      discard: [c('9', 'c')],
      wildRank: '10',
      turnIndex: 0,
      phase: 'draw',
      status: { a: 'in', b: 'in' },
    },
  });
}

test('draw then discard passes the turn to the next player', () => {
  const g = twoPlayerDrawGame();
  assert.equal(g.draw('a', 'stock').ok, true);
  assert.equal(g.hands.a.length, 14);
  assert.equal(g.phase, 'discard');
  const r = g.discardCard('a', g.hands.a[0].id);
  assert.equal(r.ok, true);
  assert.equal(g.hands.a.length, 13);
  assert.equal(g.currentSlot, 'b');
  assert.equal(g.phase, 'draw');
});

test('cannot discard before drawing, and cannot draw twice', () => {
  const g = twoPlayerDrawGame();
  assert.equal(g.discardCard('a', g.hands.a[0].id).ok, false);
  g.draw('a', 'stock');
  assert.equal(g.draw('a', 'stock').ok, false);
});

test('drawing from the discard takes its top card', () => {
  const g = twoPlayerDrawGame();
  const top = g.discard[g.discard.length - 1];
  g.draw('a', 'discard');
  assert.ok(g.hands.a.some((x) => x.id === top.id));
  assert.equal(g.discard.length, 0);
});

test('drawing from an empty stock reshuffles the discard pile', () => {
  const g = twoPlayerDrawGame();
  g.stock = [];
  g.discard = [c('2', 'h'), c('3', 'h'), c('4', 'h')]; // top stays, rest reshuffle
  const r = g.draw('a', 'stock');
  assert.equal(r.ok, true);
  assert.equal(g.discard.length, 1);
  assert.equal(g.hands.a.length, 14);
});

// ---- declare + scoring ----

function declareGame(bScore = 0) {
  const v = validThirteen();
  const junk = c('Q', 's'); // the declarer's 14th card, to be discarded
  return {
    groups: v.groups,
    discardId: junk.id,
    game: new RummyGame(['a', 'b'], {
      testState: {
        hands: { a: [...v.cards, junk], b: noMeldThirteen() },
        stock: [c('2', 'd')],
        discard: [c('9', 'c')],
        wildRank: '10',
        turnIndex: 0,
        phase: 'discard',
        scores: { a: 0, b: bScore },
        status: { a: 'in', b: 'in' },
      },
    }),
  };
}

test('a valid declaration ends the deal and scores the opponent deadwood', () => {
  const { game, groups, discardId } = declareGame();
  const r = game.declare('a', discardId, groups);
  assert.equal(r.ok, true, r.error);
  assert.equal(game.phase, 'dealover');
  assert.equal(game.lastDeal.scores.a, 0);
  assert.equal(game.lastDeal.scores.b, 80); // no-meld hand → full count 80
  assert.equal(game.scores.b, 80);
});

test('an invalid declaration is rejected with a reason and does not end the deal', () => {
  const { game, discardId } = declareGame();
  // Group everything into one big "group" — not valid melds.
  const all = game.hands.a.filter((x) => x.id !== discardId).map((x) => x.id);
  const r = game.declare('a', discardId, [all]);
  assert.equal(r.ok, false);
  assert.ok(r.reason || r.error);
  assert.equal(game.phase, 'discard'); // unchanged
});

test('crossing the pool limit eliminates a player; last one standing wins', () => {
  const { game, groups, discardId } = declareGame(50); // b already at 50 → +80 = 130 ≥ 101
  const r = game.declare('a', discardId, groups);
  assert.equal(r.ok, true, r.error);
  assert.equal(game.status.b, 'out');
  assert.equal(game.phase, 'over');
  assert.equal(game.winner, 'a');
});
