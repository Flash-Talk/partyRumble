'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { UnoGame, buildDeck } = require('../src/uno/UnoGame');

let _id = 0;
const card = (color, kind) => ({ id: `t${_id++}`, color, kind });

// Build a game with fully-controlled state.
function mk(slots, state) {
  return new UnoGame(slots, {
    testState: Object.assign({
      hands: {}, drawPile: [], discard: [card('red', '9')], currentColor: 'red',
      dir: 1, turnIndex: 0, pendingDraw: 0, pendingType: null, drewCard: null,
      needsUno: new Set(), winner: null, phase: 'playing', lastAction: { slot: null, text: '' },
    }, state),
  });
}

// ---- deck / deal ----

test('deck has the standard 108 cards', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  assert.equal(deck.filter((c) => c.kind === 'wild').length, 4);
  assert.equal(deck.filter((c) => c.kind === 'wild4').length, 4);
  assert.equal(deck.filter((c) => c.kind === '0').length, 4);   // one per color
  assert.equal(deck.filter((c) => c.kind === '5').length, 8);   // two per color
  assert.equal(deck.filter((c) => c.kind === 'draw2').length, 8);
});

test('a fresh game deals 7 each and starts on a number card', () => {
  const g = new UnoGame(['p1', 'p2', 'p3']);
  assert.equal(g.hands.p1.length, 7);
  assert.equal(g.hands.p2.length, 7);
  assert.equal(g.hands.p3.length, 7);
  assert.match(g.topCard.kind, /^[0-9]$/);
  assert.equal(g.drawPile.length, 108 - 21 - 1);
});

// ---- basic play / legality ----

test('play a color-matching card; turn advances and color updates', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('red', '5'), card('blue', '3')], p2: [card('green', '1')] },
    discard: [card('red', '9')], currentColor: 'red',
  });
  const r = g.play('p1', g.hands.p1[0].id);
  assert.ok(r.ok);
  assert.equal(g.topCard.kind, '5');
  assert.equal(g.currentColor, 'red');
  assert.equal(g.currentSlot, 'p2');
  assert.equal(g.hands.p1.length, 1);
});

test('play a symbol match across colors', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('blue', '9'), card('green', '2')], p2: [card('red', '1')] },
    discard: [card('red', '9')], currentColor: 'red',
  });
  assert.ok(g.play('p1', g.hands.p1[0].id).ok, 'blue 9 on red 9 is legal');
});

test('illegal play is rejected and nothing changes', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('blue', '3'), card('green', '2')], p2: [card('red', '1')] },
    discard: [card('red', '9')], currentColor: 'red',
  });
  const r = g.play('p1', g.hands.p1[0].id);
  assert.equal(r.ok, false);
  assert.equal(g.hands.p1.length, 2);
  assert.equal(g.currentSlot, 'p1');
});

test('wild needs a color and sets it', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('wild', 'wild'), card('red', '1')], p2: [card('green', '1')] },
    discard: [card('red', '9')], currentColor: 'red',
  });
  assert.equal(g.play('p1', g.hands.p1[0].id).ok, false, 'no color rejected');
  assert.ok(g.play('p1', g.hands.p1[0].id, 'blue').ok);
  assert.equal(g.currentColor, 'blue');
});

// ---- action cards ----

test('skip jumps the next player', () => {
  const g = mk(['p1', 'p2', 'p3'], {
    hands: { p1: [card('red', 'skip'), card('red', '1')], p2: [card('x', '0')], p3: [card('y', '0')] },
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.play('p1', g.hands.p1[0].id);
  assert.equal(g.currentSlot, 'p3');
});

test('reverse flips direction with 3 players', () => {
  const g = mk(['p1', 'p2', 'p3'], {
    hands: { p1: [card('red', 'reverse'), card('red', '1')], p2: [card('x', '0')], p3: [card('y', '0')] },
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.play('p1', g.hands.p1[0].id);
  assert.equal(g.dir, -1);
  assert.equal(g.currentSlot, 'p3'); // previous player in normal order
});

test('reverse acts as skip with 2 players', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('red', 'reverse'), card('red', '1')], p2: [card('x', '0')] },
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.play('p1', g.hands.p1[0].id);
  assert.equal(g.currentSlot, 'p1');
});

// ---- draw two / stacking ----

test('Draw Two stacks and the non-stacker draws the total then is skipped', () => {
  const g = mk(['p1', 'p2', 'p3'], {
    hands: {
      p1: [card('red', 'draw2'), card('red', '1')],
      p2: [card('blue', 'draw2'), card('blue', '1')],
      p3: [card('green', '5'), card('green', '6')],
    },
    drawPile: [card('y', '0'), card('y', '1'), card('y', '2'), card('y', '3'), card('y', '4')],
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.play('p1', g.hands.p1[0].id);
  assert.equal(g.pendingDraw, 2);
  assert.equal(g.currentSlot, 'p2');
  g.play('p2', g.hands.p2[0].id);           // stack
  assert.equal(g.pendingDraw, 4);
  assert.equal(g.currentSlot, 'p3');
  assert.equal(g.canPlay(card('green', '5')), false, 'only draw2 is playable while pending');
  g.draw('p3');
  assert.equal(g.hands.p3.length, 4 /* +4 */ + 2, 'drew the stacked 4');
  assert.equal(g.pendingDraw, 0);
  assert.equal(g.currentSlot, 'p1', 'p3 is skipped after drawing');
});

test('cannot stack Draw Four on Draw Two', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('red', 'draw2'), card('red', '1')], p2: [card('wild', 'wild4'), card('red', '1')] },
    drawPile: [card('y', '0'), card('y', '1')],
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.play('p1', g.hands.p1[0].id);
  assert.equal(g.canPlay(g.hands.p2[0]), false, 'wild4 cannot stack on draw2');
});

// ---- draw-one-then-play/pass ----

test('drawing an unplayable card ends the turn', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('blue', '3')], p2: [card('red', '1')] },
    drawPile: [card('green', '7')],
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.draw('p1');
  assert.equal(g.hands.p1.length, 2);
  assert.equal(g.currentSlot, 'p2');
});

test('drawing a playable card lets you play it or pass', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('blue', '3')], p2: [card('red', '1')] },
    drawPile: [card('red', '4')],
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.draw('p1');
  assert.equal(g.currentSlot, 'p1', 'still your turn');
  assert.ok(g.handState('p1').canPass);
  assert.equal(g.play('p1', g.hands.p1[0].id).ok, false, 'must play the drawn card, not another');
  const drawn = g.hands.p1.find((c) => c.color === 'red');
  assert.ok(g.play('p1', drawn.id).ok);
  assert.equal(g.currentSlot, 'p2');
});

// ---- UNO penalty ----

test('forgetting UNO costs 2 cards at the start of your next turn', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('red', '5'), card('red', '6')], p2: [card('red', '1'), card('blue', '2')] },
    drawPile: [card('y', '0'), card('y', '1')],
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.play('p1', g.hands.p1[0].id);           // p1 -> 1 card, did NOT call UNO
  g.play('p2', g.hands.p2[0].id);           // p2 plays red 1 -> back to p1
  assert.equal(g.hands.p1.length, 3, 'p1 was penalized +2');
});

test('calling UNO avoids the penalty', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('red', '5'), card('red', '6')], p2: [card('red', '1'), card('blue', '2')] },
    drawPile: [card('y', '0'), card('y', '1')],
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.play('p1', g.hands.p1[0].id);
  assert.ok(g.callUno('p1').ok);
  g.play('p2', g.hands.p2[0].id);
  assert.equal(g.hands.p1.length, 1, 'no penalty after calling UNO');
});

// ---- win / reshuffle ----

test('emptying your hand wins the round', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('red', '5')], p2: [card('blue', '1')] },
    discard: [card('red', '9')], currentColor: 'red',
  });
  g.play('p1', g.hands.p1[0].id);
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p1');
});

test('removing the current player advances the turn; dropping below 2 ends it', () => {
  const g = mk(['p1', 'p2', 'p3'], {
    hands: { p1: [card('red', '5')], p2: [card('blue', '1')], p3: [card('green', '2')] },
    discard: [card('red', '9')], currentColor: 'red', turnIndex: 0,
  });
  g.removePlayer('p1');                 // was current
  assert.deepEqual(g.slots, ['p2', 'p3']);
  assert.equal(g.currentSlot, 'p2', 'turn moved to the next player');
  g.removePlayer('p3');
  assert.equal(g.phase, 'over');
  assert.equal(g.winner, 'p2');
});

test('the discard reshuffles into the draw pile when it runs out', () => {
  const g = mk(['p1', 'p2'], {
    hands: { p1: [card('blue', '3')], p2: [card('red', '1')] },
    drawPile: [],
    discard: [card('red', '1'), card('green', '2'), card('red', '9')], currentColor: 'red',
  });
  g.draw('p1');
  assert.equal(g.hands.p1.length, 2, 'p1 still drew a card');
  assert.equal(g.discard.length, 1, 'discard kept only its top');
});
