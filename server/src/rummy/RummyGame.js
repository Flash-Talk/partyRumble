'use strict';

/**
 * Authoritative Indian Rummy engine (pure logic, no networking).
 * One instance per active game. Points-pool tournament: each deal the losers
 * gain deadwood points; crossing the pool limit (101) eliminates you; the last
 * player standing wins.
 *
 * Two 52-card decks + two printed jokers, deal 13, one flipped card sets the
 * wild-joker rank. Draw from stock or open discard, then discard or declare.
 * Cards come from ../cards.js.
 */

const { buildStandardDeck, shuffle } = require('../cards');
const { validateDeclaration, minDeadwood } = require('./melds');

const HAND_SIZE = 13;
const POOL_LIMIT = 101;

class RummyGame {
  constructor(slots, opts = {}) {
    this.seats = slots.slice();
    this.rng = opts.rng || Math.random;
    this.poolLimit = opts.poolLimit || POOL_LIMIT;

    this.hands = {}; this.scores = {}; this.status = {};
    for (const s of this.seats) { this.hands[s] = []; this.scores[s] = 0; this.status[s] = 'in'; }

    this.stock = [];
    this.discard = [];
    this.wildCard = null;
    this.wildRank = null;
    this.dealerIndex = null;
    this.turnIndex = 0;
    this.phase = 'idle';       // idle | draw | discard | dealover | over
    this.drawnFrom = null;
    this.drawnCardId = null;
    this.winner = null;
    this.lastAction = { slot: null, text: '' };
    this.lastDeal = null;
    this.dealNumber = 0;

    if (opts.testState) Object.assign(this, opts.testState);
  }

  get currentSlot() { return this.seats[this.turnIndex]; }

  _inSlots() { return this.seats.filter((s) => this.status[s] === 'in'); }

  _nextInIndex(from) {
    const n = this.seats.length;
    if (from == null) {
      for (let i = 0; i < n; i++) if (this.status[this.seats[i]] === 'in') return i;
      return 0;
    }
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (this.status[this.seats[i]] === 'in') return i;
    }
    return from;
  }

  // ---- deal lifecycle -------------------------------------------------------

  startDeal() {
    const inPlayers = this._inSlots();
    if (inPlayers.length <= 1) { this.phase = 'over'; this.winner = inPlayers[0] || null; return; }
    this.dealNumber += 1;
    this.dealerIndex = this._nextInIndex(this.dealerIndex);

    const deck = shuffle(buildStandardDeck({ decks: 2, jokers: 2 }), this.rng);
    for (const s of this.seats) this.hands[s] = this.status[s] === 'in' ? deck.splice(0, HAND_SIZE) : [];

    // Flip the wild-joker card (skip printed jokers so a rank is always chosen).
    let wild = deck.shift();
    while (wild && wild.joker && deck.length) wild = deck.shift();
    this.wildCard = wild;
    this.wildRank = wild && wild.rank ? wild.rank : null;

    this.discard = [deck.shift()];
    this.stock = deck;
    this.phase = 'draw';
    this.turnIndex = this._nextInIndex(this.dealerIndex);
    this.drawnFrom = null;
    this.drawnCardId = null;
    this.lastDeal = null;
    this.lastAction = { slot: null, text: `Deal #${this.dealNumber} — wild joker ${this.wildRank}` };
  }

  /** Called by the service after the deal-over pause. */
  nextDeal() { if (this.phase === 'dealover') this.startDeal(); }

  // ---- actions --------------------------------------------------------------

  draw(slot, source) {
    if (this.phase === 'over') return { ok: false, error: 'Game over' };
    if (slot !== this.currentSlot) return { ok: false, error: 'Not your turn' };
    if (this.phase !== 'draw') return { ok: false, error: 'You already drew' };

    let card;
    if (source === 'discard') {
      if (!this.discard.length) return { ok: false, error: 'Discard pile is empty' };
      card = this.discard.pop();
      this.drawnFrom = 'discard';
      this.lastAction = { slot, text: 'took the discard' };
    } else {
      if (!this.stock.length) this._reshuffle();
      if (!this.stock.length) return { ok: false, error: 'No cards left to draw' };
      card = this.stock.shift();
      this.drawnFrom = 'stock';
      this.lastAction = { slot, text: 'drew from the stock' };
    }
    this.hands[slot].push(card);
    this.drawnCardId = card.id;
    this.phase = 'discard';
    return { ok: true };
  }

  discardCard(slot, cardId) {
    if (this.phase === 'over') return { ok: false, error: 'Game over' };
    if (slot !== this.currentSlot) return { ok: false, error: 'Not your turn' };
    if (this.phase !== 'discard') return { ok: false, error: 'Draw a card first' };
    const hand = this.hands[slot];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { ok: false, error: 'Card not in your hand' };
    const [card] = hand.splice(idx, 1);
    this.discard.push(card);
    this.lastAction = { slot, text: 'discarded' };
    this.drawnFrom = null;
    this.drawnCardId = null;
    this.turnIndex = this._nextInIndex(this.turnIndex);
    this.phase = 'draw';
    return { ok: true };
  }

  /** Declare a winning hand: discard one card, group the other 13. */
  declare(slot, discardId, groupIds) {
    if (this.phase === 'over') return { ok: false, error: 'Game over' };
    if (slot !== this.currentSlot) return { ok: false, error: 'Not your turn' };
    if (this.phase !== 'discard') return { ok: false, error: 'Draw before declaring' };
    const hand = this.hands[slot];
    if (!hand.some((c) => c.id === discardId)) return { ok: false, error: 'Discard card not in your hand' };

    const byId = new Map(hand.filter((c) => c.id !== discardId).map((c) => [c.id, c]));
    const used = new Set();
    const groups = [];
    for (const gi of (groupIds || [])) {
      const g = [];
      for (const id of gi) {
        if (id === discardId) return { ok: false, error: 'You cannot group your discard' };
        const card = byId.get(id);
        if (!card) return { ok: false, error: 'A grouped card is not in your hand' };
        if (used.has(id)) return { ok: false, error: 'A card is used more than once' };
        used.add(id); g.push(card);
      }
      groups.push(g);
    }
    if (used.size !== HAND_SIZE) return { ok: false, error: 'Group all 13 of your other cards' };

    const res = validateDeclaration(groups, this.wildRank);
    if (!res.valid) return { ok: false, error: res.reason };

    const di = hand.findIndex((c) => c.id === discardId);
    const [dc] = hand.splice(di, 1);
    this.discard.push(dc);
    this._endDeal(slot);
    return { ok: true };
  }

  _endDeal(declarerSlot) {
    const result = { declarer: declarerSlot, wildRank: this.wildRank, scores: {}, eliminated: [] };
    for (const s of this.seats) {
      if (this.status[s] !== 'in') { result.scores[s] = null; continue; }
      if (s === declarerSlot) { result.scores[s] = 0; continue; }
      const dw = minDeadwood(this.hands[s], this.wildRank);
      this.scores[s] += dw;
      result.scores[s] = dw;
      if (this.scores[s] >= this.poolLimit) { this.status[s] = 'out'; result.eliminated.push(s); }
    }
    this.lastDeal = result;
    this.lastAction = { slot: declarerSlot, text: 'declared and won the deal' };

    const inPlayers = this._inSlots();
    if (inPlayers.length <= 1) { this.phase = 'over'; this.winner = inPlayers[0] || null; }
    else { this.phase = 'dealover'; }
  }

  _reshuffle() {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.stock = shuffle(this.discard, this.rng);
    this.discard = [top];
  }

  removePlayer(slot) {
    if (this.status[slot] === 'out') { this._maybeEnd(); return; }
    const wasTurn = this.currentSlot === slot && (this.phase === 'draw' || this.phase === 'discard');
    this.status[slot] = 'out';
    this.hands[slot] = [];
    this.lastAction = { slot, text: 'left the game' };

    const inPlayers = this._inSlots();
    if (inPlayers.length <= 1) { this.phase = 'over'; this.winner = inPlayers[0] || null; return; }
    if (wasTurn) {
      this.turnIndex = this._nextInIndex(this.turnIndex);
      this.phase = 'draw';
      this.drawnFrom = null;
      this.drawnCardId = null;
    }
  }

  _maybeEnd() {
    if (this.phase === 'over') return;
    const inPlayers = this._inSlots();
    if (inPlayers.length <= 1) { this.phase = 'over'; this.winner = inPlayers[0] || null; }
  }

  // ---- views ----------------------------------------------------------------

  publicState() {
    const active = this.phase === 'draw' || this.phase === 'discard';
    return {
      phase: this.phase,
      wildCard: this.wildCard,
      wildRank: this.wildRank,
      discardTop: this.discard[this.discard.length - 1] || null,
      stockCount: this.stock.length,
      turn: active ? this.currentSlot : null,
      dealNumber: this.dealNumber,
      poolLimit: this.poolLimit,
      lastAction: this.lastAction,
      winner: this.winner,
      lastDeal: this.lastDeal,
      players: this.seats.map((s) => ({
        slot: s, count: this.hands[s].length, score: this.scores[s], status: this.status[s],
      })),
    };
  }

  handState(slot) {
    const yourTurn = slot === this.currentSlot && this.status[slot] === 'in'
      && (this.phase === 'draw' || this.phase === 'discard');
    return {
      cards: this.hands[slot] || [],
      status: this.status[slot],
      phase: this.phase,
      yourTurn,
      wildRank: this.wildRank,
      discardTop: this.discard[this.discard.length - 1] || null,
      canDrawStock: yourTurn && this.phase === 'draw' && (this.stock.length > 0 || this.discard.length > 1),
      canDrawDiscard: yourTurn && this.phase === 'draw' && this.discard.length > 0,
      canDiscard: yourTurn && this.phase === 'discard',
      canDeclare: yourTurn && this.phase === 'discard',
      drawnCardId: (yourTurn && this.phase === 'discard') ? this.drawnCardId : null,
    };
  }
}

module.exports = { RummyGame, HAND_SIZE, POOL_LIMIT };
