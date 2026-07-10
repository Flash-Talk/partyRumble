'use strict';

// Regression guard for the "stuck turn" class of bug: across many random games,
// the current player must ALWAYS have a legal action (play / draw / pass), and
// every game must terminate. (The reported bug turned out to be UI-only, but
// this pins the engine invariant so a real deadlock can never regress in.)

const test = require('node:test');
const assert = require('node:assert');
const { UnoGame } = require('../src/uno/UnoGame');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const COLORS = ['red', 'yellow', 'green', 'blue'];

test('every turn always has a legal action and every game terminates (3000 games)', () => {
  for (let g = 0; g < 3000; g++) {
    const rng = mulberry32(g + 1);
    const n = 2 + Math.floor(rng() * 7);
    const slots = Array.from({ length: n }, (_, i) => `p${i + 1}`);
    const game = new UnoGame(slots, { rng });
    let steps = 0;

    while (game.phase === 'playing' && steps < 4000) {
      steps++;
      const cur = game.currentSlot;
      const hs = game.handState(cur);
      assert.ok(
        hs.playableIds.length || hs.canDraw || hs.canPass,
        `game ${g} step ${steps}: ${cur} has no legal action`,
      );

      if (hs.playableIds.length && (!hs.canPass || rng() < 0.85)) {
        const id = hs.playableIds[Math.floor(rng() * hs.playableIds.length)];
        const card = game.hands[cur].find((c) => c.id === id);
        const color = (card.kind === 'wild' || card.kind === 'wild4') ? COLORS[Math.floor(rng() * 4)] : undefined;
        game.play(cur, id, color);
      } else if (hs.canDraw) game.draw(cur);
      else game.pass(cur);

      if (rng() < 0.6) for (const s of game.slots) if (game.handState(s).canCallUno) game.callUno(s);
    }

    assert.equal(game.phase, 'over', `game ${g} did not terminate within 4000 steps`);
  }
});
