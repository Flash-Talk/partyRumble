'use strict';

/**
 * Pure Indian-Rummy meld logic: card points, sequence/set validation, full
 * declaration validation, and the opponent-scoring deadwood solver. No state.
 *
 * A card is { id, rank, suit } or a printed joker { id, joker:true }. A card is
 * "wild" (acts as a joker) if it is a printed joker OR its rank === wildRank.
 * Cards come from ../cards.js.
 */

const { RANK_VALUE } = require('../cards');

const isJoker = (card, wildRank) => card.joker === true || card.rank === wildRank;

function cardPoints(card, wildRank) {
  if (isJoker(card, wildRank)) return 0;
  const r = card.rank;
  if (r === 'A' || r === 'J' || r === 'Q' || r === 'K') return 10;
  return RANK_VALUE[r]; // 2..10
}

// Can `naturals` (same suit, no jokers) + J jokers form a consecutive run?
// Returns { feasible, gapless } where gapless means a joker-free consecutive run.
function runFeasible(naturals, J) {
  if (naturals.length === 0) return { feasible: false, gapless: false };
  const aceValues = naturals.some((c) => c.rank === 'A') ? [1, 14] : [null];
  let feasible = false; let gapless = false;
  for (const aceVal of aceValues) {
    const vals = naturals.map((c) => (c.rank === 'A' ? aceVal : RANK_VALUE[c.rank]));
    if (new Set(vals).size !== vals.length) continue; // a run cannot repeat a rank
    const min = Math.min(...vals); const max = Math.max(...vals);
    const gapsInternal = (max - min + 1) - vals.length;
    const L = vals.length + J;
    if (gapsInternal >= 0 && gapsInternal <= J && L <= 14 && min >= 1 && max <= 14) {
      feasible = true;
      if (J === 0 && gapsInternal === 0) gapless = true;
    }
  }
  return { feasible, gapless };
}

/** @returns {{valid:boolean, pure:boolean}} */
function isValidSequence(cards, wildRank) {
  if (cards.length < 3) return { valid: false, pure: false };
  const printed = cards.filter((c) => c.joker);
  const others = cards.filter((c) => !c.joker);
  // Wild-rank cards may be used as their natural card OR as a substitute joker
  // (a joker can be any suit). Only the NATURAL cards of a run must share a suit.
  const wilds = others.filter((c) => c.rank === wildRank);
  const fixed = others.filter((c) => c.rank !== wildRank);
  let fixedSuit = null;
  if (fixed.length) {
    fixedSuit = fixed[0].suit;
    if (fixed.some((c) => c.suit !== fixedSuit)) return { valid: false, pure: false };
  }

  const m = wilds.length;
  let valid = false; let pure = false;
  for (let mask = 0; mask < (1 << m); mask++) {
    const naturals = fixed.slice();
    let extraJokers = 0;
    let suitOk = true;
    for (let i = 0; i < m; i++) {
      if (mask & (1 << i)) {
        // used as a natural card — it must belong to the run's suit
        if (fixedSuit && wilds[i].suit !== fixedSuit) { suitOk = false; break; }
        naturals.push(wilds[i]);
      } else {
        extraJokers += 1; // used as a joker — suit is irrelevant
      }
    }
    if (!suitOk) continue;
    // With no fixed cards, the wilds-as-natural define the suit; require one suit.
    if (!fixedSuit && naturals.length > 1) {
      const s0 = naturals[0].suit;
      if (naturals.some((c) => c.suit !== s0)) continue;
    }
    const res = runFeasible(naturals, printed.length + extraJokers);
    if (res.feasible) {
      valid = true;
      if (printed.length + extraJokers === 0 && res.gapless) pure = true;
    }
  }
  return { valid, pure };
}

function isValidSet(cards, wildRank) {
  if (cards.length < 3 || cards.length > 4) return false;
  const printed = cards.filter((c) => c.joker);
  const others = cards.filter((c) => !c.joker);
  const wilds = others.filter((c) => c.rank === wildRank);
  const fixed = others.filter((c) => c.rank !== wildRank);
  const m = wilds.length;
  for (let mask = 0; mask < (1 << m); mask++) {
    const naturals = fixed.slice();
    let extraJokers = 0;
    for (let i = 0; i < m; i++) { if (mask & (1 << i)) naturals.push(wilds[i]); else extraJokers++; }
    const J = printed.length + extraJokers;
    if (naturals.length === 0) continue;
    const rank = naturals[0].rank;
    if (naturals.some((c) => c.rank !== rank)) continue;
    const suits = new Set(naturals.map((c) => c.suit));
    if (suits.size !== naturals.length) continue;          // distinct suits
    if (naturals.length + J !== cards.length) continue;
    if (J > 4 - naturals.length) continue;                  // jokers fill remaining suits
    return true;
  }
  return false;
}

// Classify a group: prefer a sequence reading (a set and run never coincide).
function classify(cards, wildRank) {
  const seq = isValidSequence(cards, wildRank);
  if (seq.valid) return { kind: 'seq', pure: seq.pure };
  if (isValidSet(cards, wildRank)) return { kind: 'set', pure: false };
  return { kind: null };
}

/** @returns {{valid:boolean, reason?:string}} */
function validateDeclaration(groups, wildRank) {
  const ids = [];
  let seqCount = 0; let pureCount = 0; let total = 0;
  for (const g of groups) {
    if (!g || g.length < 3) return { valid: false, reason: 'Every group needs at least 3 cards' };
    const cls = classify(g, wildRank);
    if (!cls.kind) return { valid: false, reason: 'A group is not a valid run or set' };
    if (cls.kind === 'seq') { seqCount += 1; if (cls.pure) pureCount += 1; }
    for (const c of g) ids.push(c.id);
    total += g.length;
  }
  if (total !== 13) return { valid: false, reason: 'Use all 13 cards in your groups' };
  if (new Set(ids).size !== 13) return { valid: false, reason: 'A card is used more than once' };
  if (seqCount < 2) return { valid: false, reason: 'Need at least two sequences' };
  if (pureCount < 1) return { valid: false, reason: 'Need at least one pure sequence' };
  return { valid: true };
}

/**
 * Minimum deadwood for a 13-card hand under the tiered "two life" rule:
 *  - no pure sequence anywhere → full count (min 80 of all points);
 *  - a pure sequence but only one sequence → sets do not count;
 *  - two sequences (one pure) → all melds count.
 * Deadwood is capped at 80.
 */
function minDeadwood(cards, wildRank) {
  const n = cards.length;
  const points = cards.map((c) => cardPoints(c, wildRank));
  const total = points.reduce((a, b) => a + b, 0);

  // Candidate melds: every 3+ subset that is a valid run or set.
  const candidates = [];
  for (let mask = 1; mask < (1 << n); mask++) {
    let count = 0; for (let i = 0; i < n; i++) if (mask & (1 << i)) count += 1;
    if (count < 3) continue;
    const sub = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) sub.push(cards[i]);
    const cls = classify(sub, wildRank);
    if (cls.kind) candidates.push({ mask, type: cls.kind, pure: cls.pure });
  }
  const containing = Array.from({ length: n }, () => []);
  for (const cand of candidates) {
    for (let i = 0; i < n; i++) if (cand.mask & (1 << i)) containing[i].push(cand);
  }

  const evalArrangement = (chosen) => {
    const seqs = chosen.filter((m) => m.type === 'seq');
    if (!seqs.some((m) => m.pure)) return Math.min(80, total); // no pure → full count
    let counted = 0;
    for (const m of seqs) counted |= m.mask;
    if (seqs.length >= 2) for (const m of chosen) if (m.type === 'set') counted |= m.mask;
    let dw = 0;
    for (let i = 0; i < n; i++) if (!(counted & (1 << i))) dw += points[i];
    return Math.min(80, dw);
  };

  let best = Math.min(80, total);
  const chosen = [];
  const dfs = (start, used) => {
    let i = start;
    while (i < n && (used & (1 << i))) i += 1;
    if (i >= n) { best = Math.min(best, evalArrangement(chosen)); return; }
    dfs(i + 1, used | (1 << i));           // card i left as deadwood
    for (const cand of containing[i]) {    // card i joins a meld
      if ((cand.mask & used) === 0) {
        chosen.push(cand);
        dfs(i + 1, used | cand.mask);
        chosen.pop();
      }
    }
  };
  dfs(0, 0);
  return best;
}

module.exports = {
  cardPoints, isJoker, isValidSequence, isValidSet, validateDeclaration, minDeadwood,
};
