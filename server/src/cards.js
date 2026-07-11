'use strict';

/**
 * Standard playing-card deck utilities, shared across card games.
 * Game-neutral: exposes just what a 52-card game needs. Rummy will later build
 * on this (multiple decks + printed jokers).
 *
 * Card shape: { id, rank, suit }. Ranks are strings so display is trivial;
 * RANK_VALUE maps them to comparable numbers (Ace high = 14).
 */

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['s', 'h', 'd', 'c']; // spades, hearts, diamonds, clubs

const RANK_VALUE = RANKS.reduce((m, r, i) => { m[r] = i + 2; return m; }, {}); // 2..14

/**
 * Build one or more standard 52-card decks, optionally with printed jokers.
 * Ids are stable and unique across decks (`d{deckIndex}-{rank}{suit}`), so
 * multi-deck games can still dedupe. Printed jokers are `{ id, joker:true }`.
 * @param {{decks?: number, jokers?: number}} [opts]
 * @returns {{id:string, rank?:string, suit?:string, joker?:boolean}[]}
 */
function buildStandardDeck({ decks = 1, jokers = 0 } = {}) {
  const out = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        out.push({ id: `d${d}-${rank}${suit}`, rank, suit });
      }
    }
  }
  for (let j = 0; j < jokers; j++) out.push({ id: `jk${j}`, joker: true });
  return out;
}

/** In-place Fisher–Yates shuffle. rng() must return [0,1). */
function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

module.exports = { RANKS, SUITS, RANK_VALUE, buildStandardDeck, shuffle };
