'use strict';

/**
 * Pure poker hand evaluation. No state, no networking.
 *
 * evaluateSeven(cards7) picks the best 5-card hand out of 7 and returns a
 * { category, ranks, name } descriptor. `category` is a coarse strength class;
 * `ranks` is a same-length-per-category tie-break array (high → low) compared
 * lexicographically. compareHands orders two descriptors.
 *
 * Cards use the { rank, suit } shape from ../cards.js.
 */

const { RANK_VALUE } = require('../cards');

const CATEGORY = {
  HIGH_CARD: 0,
  ONE_PAIR: 1,
  TWO_PAIR: 2,
  THREE_KIND: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  FOUR_KIND: 7,
  STRAIGHT_FLUSH: 8,
};

const NAMES = {
  0: 'High Card', 1: 'Pair', 2: 'Two Pair', 3: 'Three of a Kind', 4: 'Straight',
  5: 'Flush', 6: 'Full House', 7: 'Four of a Kind', 8: 'Straight Flush',
};

const desc = (a, b) => b - a;

/**
 * Highest card of the best 5-in-a-row within `values`, or null. Handles the
 * A-2-3-4-5 wheel (Ace counts low), which ranks as a 5-high straight.
 */
function straightHigh(values) {
  const present = new Set(values);
  if (present.has(14)) present.add(1); // Ace also low
  for (let high = 14; high >= 5; high--) {
    let ok = true;
    for (let k = 0; k < 5; k++) if (!present.has(high - k)) { ok = false; break; }
    if (ok) return high;
  }
  return null;
}

/** Values (with multiplicity) sorted high→low, minus every copy of `usedValue`s. */
function kickers(values, usedValues, n) {
  const used = new Set(usedValues);
  return values.filter((v) => !used.has(v)).sort(desc).slice(0, n);
}

/**
 * @param {{rank:string, suit:string}[]} cards7
 * @returns {{category:number, ranks:number[], name:string}}
 */
function evaluateSeven(cards7) {
  const values = cards7.map((c) => RANK_VALUE[c.rank]);
  const sorted = values.slice().sort(desc);

  // Suit buckets (for flush / straight flush).
  const bySuit = {};
  for (const c of cards7) (bySuit[c.suit] ||= []).push(RANK_VALUE[c.rank]);
  const flushSuit = Object.keys(bySuit).find((s) => bySuit[s].length >= 5) || null;

  // Straight flush: a straight within the single possible flush suit.
  if (flushSuit) {
    const sfHigh = straightHigh(bySuit[flushSuit]);
    if (sfHigh) return { category: CATEGORY.STRAIGHT_FLUSH, ranks: [sfHigh], name: sfHigh === 14 ? 'Royal Flush' : NAMES[8] };
  }

  // Rank multiplicities.
  const countByValue = new Map();
  for (const v of values) countByValue.set(v, (countByValue.get(v) || 0) + 1);
  const quads = [], trips = [], pairs = [];
  for (const [v, n] of countByValue) {
    if (n === 4) quads.push(v);
    else if (n === 3) trips.push(v);
    else if (n === 2) pairs.push(v);
  }
  quads.sort(desc); trips.sort(desc); pairs.sort(desc);

  if (quads.length) {
    return { category: CATEGORY.FOUR_KIND, ranks: [quads[0], ...kickers(sorted, [quads[0]], 1)], name: NAMES[7] };
  }

  // Full house: a trip plus any other trip/pair to fill the pair slot.
  if (trips.length && (trips.length > 1 || pairs.length)) {
    const trip = trips[0];
    const pair = Math.max(...trips.slice(1), ...pairs);
    return { category: CATEGORY.FULL_HOUSE, ranks: [trip, pair], name: NAMES[6] };
  }

  if (flushSuit) {
    return { category: CATEGORY.FLUSH, ranks: bySuit[flushSuit].slice().sort(desc).slice(0, 5), name: NAMES[5] };
  }

  const sHigh = straightHigh(values);
  if (sHigh) return { category: CATEGORY.STRAIGHT, ranks: [sHigh], name: NAMES[4] };

  if (trips.length) {
    return { category: CATEGORY.THREE_KIND, ranks: [trips[0], ...kickers(sorted, [trips[0]], 2)], name: NAMES[3] };
  }

  if (pairs.length >= 2) {
    const [hi, lo] = pairs; // already sorted desc
    return { category: CATEGORY.TWO_PAIR, ranks: [hi, lo, ...kickers(sorted, [hi, lo], 1)], name: NAMES[2] };
  }

  if (pairs.length === 1) {
    return { category: CATEGORY.ONE_PAIR, ranks: [pairs[0], ...kickers(sorted, [pairs[0]], 3)], name: NAMES[1] };
  }

  return { category: CATEGORY.HIGH_CARD, ranks: sorted.slice(0, 5), name: NAMES[0] };
}

/** -1 / 0 / 1 comparing two evaluateSeven descriptors. */
function compareHands(a, b) {
  if (a.category !== b.category) return a.category < b.category ? -1 : 1;
  for (let i = 0; i < a.ranks.length; i++) {
    if (a.ranks[i] !== b.ranks[i]) return a.ranks[i] < b.ranks[i] ? -1 : 1;
  }
  return 0;
}

module.exports = { evaluateSeven, compareHands, CATEGORY, NAMES };
