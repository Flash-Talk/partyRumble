'use strict';

/**
 * Authoritative Texas Hold'em engine (pure logic, no networking).
 * One instance per active poker game. The server owns it; a client never sees
 * another player's hole cards until showdown.
 *
 * Tournament format: equal starting stacks, fixed blinds, bust at zero chips,
 * keep dealing hands until one player has all the chips.
 *
 * Card shape { id, rank, suit } comes from ../cards.js.
 */

const { buildStandardDeck, shuffle } = require('../cards');
const { evaluateSeven, compareHands } = require('./handRank');

const START_STACK = 1000;
const SMALL_BLIND = 10;
const BIG_BLIND = 20;

const BETTING_STREETS = new Set(['preflop', 'flop', 'turn', 'river']);

class PokerGame {
  constructor(slots, opts = {}) {
    this.seats = slots.slice();
    this.rng = opts.rng || Math.random;
    const ts = opts.testState || {};
    this.startStack = ts.startStack || opts.startStack || START_STACK;
    this.smallBlind = opts.smallBlind || SMALL_BLIND;
    this.bigBlind = opts.bigBlind || BIG_BLIND;

    const stacks = ts.stacks || {};
    this.players = {};
    for (const s of this.seats) {
      this.players[s] = {
        slot: s,
        stack: stacks[s] != null ? stacks[s] : this.startStack,
        bet: 0,          // committed this street
        committed: 0,    // committed this hand (drives side pots)
        status: 'active',
        hole: [],
        hasActed: false, // acted since the last aggressive action this street
        canRaise: true,  // may still (re)raise this street
      };
    }

    this.buttonIndex = null;
    this.deck = [];
    this.community = [];
    this.street = 'idle';     // idle | preflop | flop | turn | river | showdown | handover | over
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.toAct = null;
    this.phase = 'playing';   // playing | over
    this.winner = null;
    this.lastAction = { slot: null, text: '' };
    this.handResult = null;
    this.handNumber = 0;
    this._sbSlot = null;
    this._bbSlot = null;
  }

  get button() { return this.buttonIndex == null ? null : this.seats[this.buttonIndex]; }

  // ---- helpers --------------------------------------------------------------

  _liveSlots() { return this.seats.filter((s) => this.players[s].status !== 'out'); }
  _isBettingStreet() { return BETTING_STREETS.has(this.street); }
  _needsToAct(p) { return p.status === 'active' && (!p.hasActed || p.bet < this.currentBet); }

  /** Slots in seat order starting from `startSlot` (inclusive or not), wrapping. */
  _orderFrom(startSlot, inclusive) {
    const start = this.seats.indexOf(startSlot);
    const n = this.seats.length;
    const out = [];
    for (let k = inclusive ? 0 : 1; k < n; k++) out.push(this.seats[(start + k) % n]);
    if (inclusive) out.push(this.seats[start]); // ensure start included exactly once at front
    return inclusive ? out.slice(0, n) : out;
  }

  /** Live slots after the button, in seat order (button lands last). */
  _liveAfterButton() {
    const n = this.seats.length;
    const out = [];
    for (let k = 1; k <= n; k++) {
      const s = this.seats[(this.buttonIndex + k) % n];
      if (this.players[s].status !== 'out') out.push(s);
    }
    return out;
  }

  _firstNeedingFrom(startSlot, inclusive) {
    for (const s of this._orderFrom(startSlot, inclusive)) {
      if (this._needsToAct(this.players[s])) return s;
    }
    return null;
  }

  _nextLiveIndex(from) {
    const n = this.seats.length;
    if (from == null) {
      for (let i = 0; i < n; i++) if (this.players[this.seats[i]].status !== 'out') return i;
      return null;
    }
    for (let k = 1; k <= n; k++) {
      const i = (from + k) % n;
      if (this.players[this.seats[i]].status !== 'out') return i;
    }
    return from;
  }

  // ---- hand lifecycle -------------------------------------------------------

  startHand() {
    // Bust anyone who hit zero last hand.
    for (const s of this.seats) {
      const p = this.players[s];
      if (p.status !== 'out' && p.stack <= 0) p.status = 'out';
    }
    const live = this._liveSlots();
    if (live.length < 2) {
      this.phase = 'over';
      this.winner = live[0] || null;
      this.street = 'over';
      this.toAct = null;
      return;
    }

    this.handNumber += 1;
    for (const s of live) {
      const p = this.players[s];
      p.bet = 0; p.committed = 0; p.status = 'active'; p.hole = [];
      p.hasActed = false; p.canRaise = true;
    }
    this.buttonIndex = this._nextLiveIndex(this.buttonIndex);
    this.deck = shuffle(buildStandardDeck({ decks: 1 }), this.rng);
    this.community = [];
    this.handResult = null;
    this.street = 'preflop';
    this.currentBet = 0;
    this.minRaise = this.bigBlind;
    this.lastAction = { slot: null, text: `Hand #${this.handNumber} dealt` };

    // Deal two hole cards to each live player, starting left of the button.
    const order = this._liveAfterButton();
    for (let round = 0; round < 2; round++) {
      for (const s of order) this.players[s].hole.push(this.deck.shift());
    }

    this._postBlinds(order);
  }

  _postBlinds(order) {
    let sbSlot, bbSlot, firstSlot;
    if (order.length === 2) {
      // Heads-up: button posts SB and acts first preflop.
      sbSlot = this.button;
      bbSlot = order[0];
      firstSlot = this.button;
    } else {
      sbSlot = order[0];
      bbSlot = order[1];
      firstSlot = order[2 % order.length];
    }
    this._postBlind(sbSlot, this.smallBlind);
    this._postBlind(bbSlot, this.bigBlind);
    this._sbSlot = sbSlot; this._bbSlot = bbSlot;
    this.currentBet = Math.max(this.players[sbSlot].bet, this.players[bbSlot].bet);
    this.minRaise = this.bigBlind;
    this.toAct = this._firstNeedingFrom(firstSlot, true);
  }

  _postBlind(slot, amount) {
    const p = this.players[slot];
    const pay = Math.min(amount, p.stack);
    p.stack -= pay; p.bet += pay; p.committed += pay;
    if (p.stack === 0) p.status = 'allin';
  }

  // ---- actions --------------------------------------------------------------

  legalActions(slot) {
    const none = { canFold: false, canCheck: false, canCall: false, callAmount: 0, canRaise: false, minRaiseTo: 0, maxRaiseTo: 0, canAllIn: false };
    if (this.phase !== 'playing' || !this._isBettingStreet() || slot !== this.toAct) return none;
    const p = this.players[slot];
    const toCall = Math.max(0, this.currentBet - p.bet);
    const maxRaiseTo = p.bet + p.stack;
    let minRaiseTo = this.currentBet + this.minRaise;
    if (minRaiseTo > maxRaiseTo) minRaiseTo = maxRaiseTo; // short stack: only all-in
    return {
      canFold: true,
      canCheck: toCall === 0,
      canCall: toCall > 0,
      callAmount: Math.min(toCall, p.stack),
      canRaise: p.canRaise && p.stack > toCall,
      minRaiseTo,
      maxRaiseTo,
      canAllIn: p.stack > 0,
    };
  }

  /** @returns {{ok:boolean, error?:string}} */
  act(slot, action, amount) {
    if (this.phase !== 'playing') return { ok: false, error: 'Game over' };
    if (!this._isBettingStreet()) return { ok: false, error: 'Not a betting round' };
    if (slot !== this.toAct) return { ok: false, error: 'Not your turn' };
    const p = this.players[slot];

    switch (action) {
      case 'fold':
        p.status = 'folded'; p.hasActed = true;
        this.lastAction = { slot, text: 'folds' };
        break;

      case 'check':
        if (p.bet !== this.currentBet) return { ok: false, error: 'Cannot check — there is a bet' };
        p.hasActed = true;
        this.lastAction = { slot, text: 'checks' };
        break;

      case 'call': {
        const toCall = this.currentBet - p.bet;
        if (toCall <= 0) return { ok: false, error: 'Nothing to call — check instead' };
        const pay = Math.min(toCall, p.stack);
        p.stack -= pay; p.bet += pay; p.committed += pay; p.hasActed = true;
        if (p.stack === 0) p.status = 'allin';
        this.lastAction = { slot, text: pay < toCall ? `calls all-in (${pay})` : `calls ${pay}` };
        break;
      }

      case 'raise':
      case 'allin': {
        const maxTotal = p.bet + p.stack;
        const target = action === 'allin' ? maxTotal : Math.floor(amount);
        if (!Number.isFinite(target)) return { ok: false, error: 'Bad amount' };
        if (target > maxTotal) return { ok: false, error: 'Not enough chips' };

        if (target <= this.currentBet) {
          // Not a raise. An all-in for less than the current bet is a short call.
          if (action === 'allin') {
            const pay = p.stack;
            p.stack = 0; p.bet += pay; p.committed += pay; p.status = 'allin'; p.hasActed = true;
            this.lastAction = { slot, text: `calls all-in (${pay})` };
            break;
          }
          return { ok: false, error: 'Raise must exceed the current bet' };
        }

        const isAllIn = target === maxTotal;
        const increment = target - this.currentBet;
        if (!isAllIn) {
          if (!p.canRaise) return { ok: false, error: 'You cannot raise now' };
          if (increment < this.minRaise) return { ok: false, error: `Raise to at least ${this.currentBet + this.minRaise}` };
        }

        const pay = target - p.bet;
        p.stack -= pay; p.bet = target; p.committed += pay; p.hasActed = true;
        if (p.stack === 0) p.status = 'allin';
        const fullRaise = increment >= this.minRaise;
        this.currentBet = target;
        if (fullRaise) {
          this.minRaise = increment;
          for (const s of this.seats) {
            const q = this.players[s];
            if (s !== slot && q.status === 'active') { q.hasActed = false; q.canRaise = true; }
          }
          this.lastAction = { slot, text: p.status === 'allin' ? `raises all-in to ${target}` : `raises to ${target}` };
        } else {
          // Short all-in: players who haven't matched must respond, but it does
          // not grant a fresh re-raise right to those already closed.
          for (const s of this.seats) {
            const q = this.players[s];
            if (s !== slot && q.status === 'active' && q.bet < this.currentBet) q.hasActed = false;
          }
          this.lastAction = { slot, text: `is all-in (${target})` };
        }
        p.canRaise = false;
        break;
      }

      default:
        return { ok: false, error: 'Unknown action' };
    }

    this._progress(slot);
    return { ok: true };
  }

  _progress(fromSlot) {
    const inHand = this.seats.filter((s) => {
      const st = this.players[s].status;
      return st === 'active' || st === 'allin';
    });
    if (inHand.length <= 1) {
      if (inHand.length === 1) this._awardUncontested(inHand[0]);
      else this._finishHand();
      return;
    }
    const next = this._firstNeedingFrom(fromSlot, false);
    if (next) { this.toAct = next; return; }
    this._advanceStreet();
  }

  _advanceStreet() {
    if (this.street === 'river') { this._showdown(); return; }

    for (const s of this.seats) {
      const p = this.players[s];
      if (p.status === 'active') { p.bet = 0; p.hasActed = false; p.canRaise = true; }
      else if (p.status === 'allin') { p.bet = 0; }
    }
    this.currentBet = 0;
    this.minRaise = this.bigBlind;

    const deal = (n) => { for (let i = 0; i < n; i++) this.community.push(this.deck.shift()); };
    if (this.street === 'preflop') { deal(3); this.street = 'flop'; }
    else if (this.street === 'flop') { deal(1); this.street = 'turn'; }
    else if (this.street === 'turn') { deal(1); this.street = 'river'; }

    const activeCount = this.seats.filter((s) => this.players[s].status === 'active').length;
    if (activeCount >= 2) {
      this.toAct = this._firstNeedingFrom(this.button, false);
      if (!this.toAct) this._advanceStreet();
    } else {
      this.toAct = null;
      this._advanceStreet(); // no betting possible — run the board out
    }
  }

  _showdown() {
    this.street = 'showdown';
    this._settle();
    this._finishHand();
  }

  _settle() {
    const contributors = this.seats.map((s) => this.players[s]).filter((p) => p.committed > 0);
    const levels = [...new Set(contributors.map((p) => p.committed))].sort((a, b) => a - b);
    const board = this.community;
    const evalCache = {};
    const handOf = (p) => (evalCache[p.slot] ||= evaluateSeven(board.concat(p.hole)));

    // Build layered pots from committed amounts.
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      const slice = L - prev;
      const inPot = contributors.filter((p) => p.committed >= L);
      const eligible = inPot.filter((p) => p.status === 'active' || p.status === 'allin');
      pots.push({ amount: slice * inPot.length, eligible });
      prev = L;
    }

    const order = this._orderFrom(this.button, false); // for odd-chip distribution
    const payouts = {};
    for (const pot of pots) {
      if (pot.amount <= 0 || pot.eligible.length === 0) continue;
      let best = null; let winners = [];
      for (const p of pot.eligible) {
        const h = handOf(p);
        const cmp = best ? compareHands(h, best) : 1;
        if (cmp > 0) { best = h; winners = [p]; }
        else if (cmp === 0) winners.push(p);
      }
      winners.sort((x, y) => order.indexOf(x.slot) - order.indexOf(y.slot));
      const each = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - each * winners.length;
      for (const w of winners) {
        let add = each;
        if (rem > 0) { add += 1; rem -= 1; }
        w.stack += add;
        payouts[w.slot] = (payouts[w.slot] || 0) + add;
      }
    }

    const revealed = {};
    for (const p of contributors) {
      if (p.status === 'active' || p.status === 'allin') revealed[p.slot] = p.hole.slice();
    }
    this.handResult = {
      showdown: true,
      board: board.slice(),
      revealed,
      winners: Object.entries(payouts).map(([slot, amount]) => ({
        slot, amount, hand: evalCache[slot] ? evalCache[slot].name : null,
      })),
    };
    this.lastAction = { slot: null, text: 'Showdown' };
  }

  _awardUncontested(winnerSlot) {
    const pot = this.seats.reduce((sum, s) => sum + this.players[s].committed, 0);
    this.players[winnerSlot].stack += pot;
    this.handResult = {
      uncontested: true,
      board: this.community.slice(),
      revealed: {},
      winners: [{ slot: winnerSlot, amount: pot, hand: null }],
    };
    this.lastAction = { slot: winnerSlot, text: `wins ${pot}` };
    this._finishHand();
  }

  _finishHand() {
    this.street = 'handover';
    this.toAct = null;
    for (const s of this.seats) {
      const p = this.players[s];
      if (p.status !== 'out' && p.stack <= 0) p.status = 'out';
    }
    const live = this._liveSlots();
    if (live.length <= 1) { this.phase = 'over'; this.winner = live[0] || null; }
  }

  /** A player left the table for good: fold them out of any live hand, then out. */
  removePlayer(slot) {
    const p = this.players[slot];
    if (!p || p.status === 'out') { this._maybeEndTournament(); return; }
    const wasToAct = this.toAct === slot;
    const wasInHand = p.status === 'active' || p.status === 'allin';
    p.status = 'out';
    p.stack = 0;
    p.hole = [];
    this.lastAction = { slot, text: 'left the table' };

    if (this.phase === 'playing' && this._isBettingStreet() && wasInHand) {
      const inHand = this.seats.filter((s) => {
        const st = this.players[s].status;
        return st === 'active' || st === 'allin';
      });
      if (inHand.length <= 1) {
        if (inHand.length === 1) this._awardUncontested(inHand[0]);
        else this._finishHand();
      } else if (wasToAct) {
        this._progress(slot);
      }
    }
    this._maybeEndTournament();
  }

  _maybeEndTournament() {
    if (this.phase === 'over') return;
    const live = this._liveSlots();
    if (live.length <= 1) { this.phase = 'over'; this.winner = live[0] || null; this.toAct = null; }
  }

  // ---- views ----------------------------------------------------------------

  publicState() {
    const pot = this.seats.reduce((sum, s) => sum + this.players[s].committed, 0);
    const revealed = (this.handResult && this.handResult.revealed) || {};
    return {
      phase: this.phase,
      street: this.street,
      community: this.community.slice(),
      pot,
      currentBet: this.currentBet,
      minRaise: this.minRaise,
      button: this.button,
      sb: this._sbSlot,
      bb: this._bbSlot,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      toAct: this.toAct,
      handNumber: this.handNumber,
      lastAction: this.lastAction,
      winner: this.winner,
      handResult: this.handResult,
      players: this.seats.map((s) => {
        const p = this.players[s];
        return {
          slot: s,
          stack: p.stack,
          bet: p.bet,
          committed: p.committed,
          status: p.status,
          hasCards: p.status !== 'out' && p.status !== 'folded' && p.hole.length > 0,
          hole: revealed[s] || null,
        };
      }),
    };
  }

  holeState(slot) {
    const p = this.players[slot];
    if (!p) return null;
    return {
      hole: p.hole || [],
      status: p.status,
      yourTurn: slot === this.toAct,
      legalActions: this.legalActions(slot),
    };
  }
}

module.exports = { PokerGame, START_STACK, SMALL_BLIND, BIG_BLIND };
