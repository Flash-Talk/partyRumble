'use strict';

/**
 * Authoritative UNO game engine (pure logic, no networking).
 * One instance per active UNO round. The server owns it; clients never see
 * another player's hand.
 *
 * Rules: 108-card deck, deal 7, match by color or number/symbol, Skip, Reverse
 * (acts as Skip with 2 players), Draw Two, Wild, Wild Draw Four, stacking of
 * Draw Two/Four to pass the penalty on, reshuffle discard when the draw pile
 * empties, "UNO!" button with a +2 penalty if you start your next turn at one
 * card without calling it. First to empty their hand wins.
 */

const COLORS = ['red', 'yellow', 'green', 'blue'];
const NUMBERS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
const isWild = (c) => c.kind === 'wild' || c.kind === 'wild4';
const mod = (n, m) => ((n % m) + m) % m;

function buildDeck() {
  const deck = [];
  let id = 0;
  const add = (color, kind) => deck.push({ id: `c${id++}`, color, kind });
  for (const color of COLORS) {
    add(color, '0');
    for (let n = 1; n <= 9; n++) { add(color, String(n)); add(color, String(n)); }
    for (const k of ['skip', 'reverse', 'draw2']) { add(color, k); add(color, k); }
  }
  for (let i = 0; i < 4; i++) add('wild', 'wild');
  for (let i = 0; i < 4; i++) add('wild', 'wild4');
  return deck;
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

class UnoGame {
  constructor(slots, opts = {}) {
    this.slots = slots.slice();
    this.rng = opts.rng || Math.random;
    this.hands = {};
    this.slots.forEach((s) => { this.hands[s] = []; });
    this.drawPile = [];
    this.discard = [];
    this.currentColor = null;
    this.dir = 1;
    this.turnIndex = 0;
    this.pendingDraw = 0;
    this.pendingType = null;        // 'draw2' | 'draw4'
    this.drewCard = null;           // id of a just-drawn card (must play it or pass)
    this.needsUno = new Set();      // slots at 1 card who haven't called UNO
    this.winner = null;
    this.phase = 'playing';
    this.lastAction = { slot: null, text: 'Game started' };

    if (opts.testState) Object.assign(this, opts.testState);
    else this._deal();
  }

  _deal() {
    const deck = shuffle(buildDeck(), this.rng);
    for (const s of this.slots) this.hands[s] = deck.splice(0, 7);
    // First discard: reshuffle until a plain number card starts (v1 simplification).
    let top;
    let guard = 0;
    do {
      top = deck.shift();
      if (NUMBERS.has(top.kind)) break;
      deck.push(top);
      shuffle(deck, this.rng);
    } while (guard++ < 500);
    this.discard = [top];
    this.drawPile = deck;
    this.currentColor = top.color;
  }

  get currentSlot() { return this.slots[this.turnIndex]; }
  get topCard() { return this.discard[this.discard.length - 1]; }

  canPlay(card) {
    if (this.pendingDraw > 0) return card.kind === this.pendingType; // must stack same type
    if (isWild(card)) return true;
    if (card.color === this.currentColor) return true;
    const top = this.topCard;
    if (!isWild(top) && card.kind === top.kind) return true;
    return false;
  }

  playableIds(slot) {
    if (slot !== this.currentSlot || this.phase !== 'playing') return [];
    const hand = this.hands[slot];
    if (this.drewCard) {
      const c = hand.find((x) => x.id === this.drewCard);
      return c && this.canPlay(c) ? [c.id] : [];
    }
    return hand.filter((c) => this.canPlay(c)).map((c) => c.id);
  }

  publicState() {
    return {
      phase: this.phase,
      players: this.slots.map((s) => ({ slot: s, count: this.hands[s].length })),
      topCard: this.topCard,
      currentColor: this.currentColor,
      currentSlot: this.currentSlot,
      direction: this.dir,
      pendingDraw: this.pendingDraw,
      pendingType: this.pendingType,
      lastAction: this.lastAction,
      winner: this.winner,
      drawPileCount: this.drawPile.length,
    };
  }

  handState(slot) {
    const hand = this.hands[slot] || [];
    const yourTurn = slot === this.currentSlot && this.phase === 'playing';
    return {
      cards: hand,
      yourTurn,
      playableIds: this.playableIds(slot),
      canDraw: yourTurn && this.drewCard === null,
      canPass: yourTurn && this.drewCard !== null,
      canCallUno: hand.length === 1 && this.needsUno.has(slot),
      pendingDraw: this.pendingDraw,
      mustStackOrDraw: this.pendingDraw > 0 && yourTurn,
    };
  }

  // ---- actions (return { ok, error? }) -------------------------------------

  play(slot, cardId, chosenColor) {
    if (this.phase !== 'playing') return { ok: false, error: 'Game over' };
    if (slot !== this.currentSlot) return { ok: false, error: 'Not your turn' };
    const hand = this.hands[slot];
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) return { ok: false, error: 'Card not in hand' };
    if (this.drewCard && cardId !== this.drewCard) return { ok: false, error: 'Play the drawn card or pass' };
    const card = hand[idx];
    if (!this.canPlay(card)) return { ok: false, error: 'Illegal move' };
    if (isWild(card) && !COLORS.includes(chosenColor)) return { ok: false, error: 'Pick a color' };

    hand.splice(idx, 1);
    this.discard.push(card);
    this.currentColor = isWild(card) ? chosenColor : card.color;
    this.drewCard = null;

    if (hand.length === 0) {
      this.winner = slot;
      this.phase = 'over';
      this.lastAction = { slot, text: 'played their last card and WON!' };
      return { ok: true };
    }
    if (hand.length === 1) this.needsUno.add(slot);

    switch (card.kind) {
      case 'skip':
        this.lastAction = { slot, text: 'played Skip' };
        this._advance(2);
        break;
      case 'reverse':
        this.dir *= -1;
        this.lastAction = { slot, text: 'played Reverse' };
        this._advance(this.slots.length === 2 ? 2 : 1);
        break;
      case 'draw2':
        this.pendingDraw += 2; this.pendingType = 'draw2';
        this.lastAction = { slot, text: `played Draw Two (+${this.pendingDraw} pending)` };
        this._advance(1);
        break;
      case 'wild4':
        this.pendingDraw += 4; this.pendingType = 'draw4';
        this.lastAction = { slot, text: `played Wild Draw Four (+${this.pendingDraw} pending)` };
        this._advance(1);
        break;
      case 'wild':
        this.lastAction = { slot, text: `played Wild → ${chosenColor}` };
        this._advance(1);
        break;
      default:
        this.lastAction = { slot, text: `played ${card.color} ${card.kind}` };
        this._advance(1);
    }
    return { ok: true };
  }

  draw(slot) {
    if (this.phase !== 'playing') return { ok: false, error: 'Game over' };
    if (slot !== this.currentSlot) return { ok: false, error: 'Not your turn' };
    if (this.drewCard) return { ok: false, error: 'Already drew' };

    if (this.pendingDraw > 0) {
      const n = this.pendingDraw;
      this._drawCards(slot, n);
      this.pendingDraw = 0; this.pendingType = null;
      this.lastAction = { slot, text: `drew ${n}` };
      this._advance(1);
      return { ok: true };
    }

    const [c] = this._drawCards(slot, 1);
    this.lastAction = { slot, text: 'drew a card' };
    if (c && this.canPlay(c)) this.drewCard = c.id; // may play it or pass
    else this._advance(1);
    return { ok: true };
  }

  pass(slot) {
    if (this.phase !== 'playing') return { ok: false, error: 'Game over' };
    if (slot !== this.currentSlot) return { ok: false, error: 'Not your turn' };
    if (!this.drewCard) return { ok: false, error: 'Draw first' };
    this.drewCard = null;
    this.lastAction = { slot, text: 'passed' };
    this._advance(1);
    return { ok: true };
  }

  callUno(slot) {
    if ((this.hands[slot] || []).length !== 1) return { ok: false, error: 'Not at one card' };
    this.needsUno.delete(slot);
    this.lastAction = { slot, text: 'called UNO!' };
    return { ok: true };
  }

  /** A player left for good: drop them from the round. Ends it if <2 remain. */
  removePlayer(slot) {
    const i = this.slots.indexOf(slot);
    if (i === -1) return;
    delete this.hands[slot];
    this.slots.splice(i, 1);
    this.needsUno.delete(slot);
    this.drewCard = null;

    if (this.slots.length < 2) {
      this.phase = 'over';
      this.winner = this.slots[0] || null;
      this.lastAction = { slot, text: 'left — round over' };
      return;
    }
    // Keep the turn pointing at the right player after the array shrank.
    if (i < this.turnIndex) this.turnIndex -= 1;
    this.turnIndex = mod(this.turnIndex, this.slots.length);
    this.lastAction = { slot, text: 'left the game' };
  }

  // ---- internals -----------------------------------------------------------

  _advance(steps) {
    this.turnIndex = mod(this.turnIndex + steps * this.dir, this.slots.length);
    this.drewCard = null;
    const s = this.currentSlot;
    if (this.needsUno.has(s) && this.hands[s].length === 1) {
      this.needsUno.delete(s);
      this._drawCards(s, 2);
      this.lastAction = { slot: s, text: 'forgot to say UNO! (+2)' };
    } else {
      this.needsUno.delete(s);
    }
  }

  _drawCards(slot, n) {
    const drawn = [];
    for (let i = 0; i < n; i++) {
      if (this.drawPile.length === 0) this._reshuffle();
      if (this.drawPile.length === 0) break;
      const c = this.drawPile.shift();
      this.hands[slot].push(c);
      drawn.push(c);
    }
    return drawn;
  }

  _reshuffle() {
    if (this.discard.length <= 1) return;
    const top = this.discard.pop();
    this.drawPile = shuffle(this.discard, this.rng);
    this.discard = [top];
  }
}

module.exports = { UnoGame, buildDeck, COLORS };
