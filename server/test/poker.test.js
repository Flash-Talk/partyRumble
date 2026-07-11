'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PokerGame } = require('../src/poker/PokerGame');

// Deterministic rng so deals are reproducible; the tests below mostly drive
// betting logic and don't depend on which specific cards come out.
function seededRng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function mk(slots, opts = {}) {
  return new PokerGame(slots, { rng: seededRng(opts.seed || 1), ...opts });
}

// ---- blinds & positions ----

test('heads-up: button posts small blind and acts first preflop', () => {
  const g = mk(['a', 'b']);
  g.startHand();
  const btn = g.button;                    // slot on the button
  const other = btn === 'a' ? 'b' : 'a';
  assert.equal(g.players[btn].bet, g.smallBlind, 'button posts SB');
  assert.equal(g.players[other].bet, g.bigBlind, 'other posts BB');
  assert.equal(g.toAct, btn, 'button acts first preflop heads-up');
  assert.equal(g.currentBet, g.bigBlind);
});

test('3+ players: SB/BB left of button, UTG acts first', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  // button is 'a' on the first hand (dealer = first live seat)
  assert.equal(g.button, 'a');
  assert.equal(g.players.b.bet, g.smallBlind);
  assert.equal(g.players.c.bet, g.bigBlind);
  assert.equal(g.toAct, 'a'); // UTG (left of BB) — wraps back to a
});

// ---- basic betting ----

test('everyone calls preflop, BB checks option, advances to flop', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand(); // toAct a
  assert.equal(g.act('a', 'call').ok, true);   // a calls 20
  assert.equal(g.act('b', 'call').ok, true);   // sb completes to 20
  assert.equal(g.toAct, 'c');                  // BB option
  assert.equal(g.act('c', 'check').ok, true);  // BB checks
  assert.equal(g.street, 'flop');
  assert.equal(g.community.length, 3);
  assert.equal(g.currentBet, 0);
});

test('cannot check facing a bet; call is required', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  const r = g.act('a', 'check');
  assert.equal(r.ok, false);
});

test('raise must be at least the minimum raise', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand(); // currentBet 20, minRaise 20
  const tooSmall = g.act('a', 'raise', 30); // needs >= 40
  assert.equal(tooSmall.ok, false);
  assert.equal(g.act('a', 'raise', 40).ok, true);
  assert.equal(g.currentBet, 40);
  assert.equal(g.minRaise, 20);
});

test('a raise reopens action for players who already called', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('a', 'call');            // a in for 20
  g.act('b', 'raise', 60);       // sb raises to 60
  assert.equal(g.toAct, 'c');    // bb faces the raise
  g.act('c', 'call');
  assert.equal(g.toAct, 'a');    // a must act again (reopened)
});

// ---- fold to win ----

test('everyone folds to one player: they win the pot uncontested', () => {
  const g = mk(['a', 'b', 'c']);
  g.startHand();
  g.act('a', 'fold');
  g.act('b', 'fold');            // sb folds; bb (c) wins
  assert.equal(g.street, 'handover');
  // c posted BB (20) and won a's 0 + b's SB (10): net +10 over the 1000 start.
  assert.equal(g.players.c.stack, g.startStack + g.smallBlind);
  assert.ok(g.handResult.winners.some((w) => w.slot === 'c'));
});

// ---- all-in & side pots ----

test('all-in produces correct main and side pots', () => {
  // Three players with unequal stacks all get to showdown all-in.
  const g = new PokerGame(['a', 'b', 'c'], {
    rng: seededRng(3),
    testState: {
      startStack: 1000,
      stacks: { a: 100, b: 300, c: 1000 },
    },
  });
  g.startHand();
  // Drive everyone all-in preflop.
  // toAct starts at 'a'. Everyone shoves; the engine builds pots from committed.
  g.act(g.toAct, 'allin');
  g.act(g.toAct, 'allin');
  g.act(g.toAct, 'allin');
  // Betting closed, board dealt out to showdown/handover.
  assert.equal(g.street, 'handover');
  // Total chips are conserved across all stacks.
  const total = g.players.a.stack + g.players.b.stack + g.players.c.stack;
  assert.equal(total, 100 + 300 + 1000);
  // 'a' (100) can win at most 3*100 = 300; anything above sits in side pots.
  assert.ok(g.players.a.stack <= 300);
});

// ---- bust-out & tournament end ----

test('busted players go out and the tournament ends with one winner', () => {
  const g = new PokerGame(['a', 'b'], {
    rng: seededRng(5),
    testState: { startStack: 1000, stacks: { a: 40, b: 1000 } },
  });
  g.startHand();
  // Shove it all in heads-up; someone busts.
  g.act(g.toAct, 'allin');
  g.act(g.toAct, 'allin');
  // A hand where one player can bust: if 'a' loses they're out and it's over.
  if (g.players.a.stack === 0 || g.players.b.stack === 0) {
    assert.equal(g.phase, 'over');
    assert.ok(g.winner === 'a' || g.winner === 'b');
  }
});

test('chips are conserved every hand', () => {
  const g = mk(['a', 'b', 'c', 'd']);
  g.startHand();
  let guard = 0;
  while (g.street !== 'handover' && guard++ < 50) {
    g.act(g.toAct, 'call');
  }
  const total = ['a', 'b', 'c', 'd'].reduce((s, k) => s + g.players[k].stack, 0)
    + ['a', 'b', 'c', 'd'].reduce((s, k) => s + g.players[k].committed, 0);
  assert.equal(total, 4 * g.startStack);
});
