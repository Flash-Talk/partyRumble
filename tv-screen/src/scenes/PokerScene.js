// TV view of a Texas Hold'em tournament. Renders the server's public state
// (Net.pokerState / 'poker_state'); the server is authoritative. Hole cards are
// hidden until a showdown reveals them.
import Net from '../net.js';
import audio from '../audio.js';
import { DESIGN } from '../config.js';

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const isRed = (suit) => suit === 'h' || suit === 'd';
const hexNum = (hex) => parseInt(String(hex).replace('#', ''), 16);

const STREET_LABEL = {
  preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River',
  showdown: 'Showdown', handover: 'Hand over',
};

// Table geometry in the 1920x1080 design space.
const TABLE = { cx: 960, cy: 486, rx: 560, ry: 300 };   // green felt oval
const SEAT = { rx: 760, ry: 392 };                       // seat ring (outside the felt)

export default class PokerScene extends Phaser.Scene {
  constructor() { super('PokerScene'); }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');
    audio.music('game');
    this.dyn = [];
    this.over = false;
    this._prevAction = '';
    this._prevHandKey = '';
    this.turnEndsAt = null;
    this.turnMs = 30000;
    this.activePos = null;

    // Felt table (persistent).
    const felt = this.add.graphics();
    felt.fillStyle(0x0b3d2e, 1);
    felt.fillEllipse(TABLE.cx, TABLE.cy, TABLE.rx * 2, TABLE.ry * 2);
    felt.lineStyle(10, 0x0a2a20, 1);
    felt.strokeEllipse(TABLE.cx, TABLE.cy, TABLE.rx * 2, TABLE.ry * 2);
    felt.lineStyle(3, 0x1f7a5a, 0.7);
    felt.strokeEllipse(TABLE.cx, TABLE.cy, TABLE.rx * 2 - 40, TABLE.ry * 2 - 40);

    this.add.text(DESIGN.W / 2, 24, "TEXAS HOLD'EM", {
      fontFamily: 'system-ui, sans-serif', fontSize: '38px', fontStyle: 'bold', color: '#e8c15a',
    }).setOrigin(0.5, 0);

    this.turnBar = this.add.graphics(); // countdown under the active seat

    this.waiting = this.add.text(DESIGN.W / 2, TABLE.cy, 'Shuffling up…', {
      fontFamily: 'system-ui, sans-serif', fontSize: '44px', color: '#cfe8dd',
    }).setOrigin(0.5);

    this.onState = (s) => this.render(s);
    this.onOver = (d) => this.showWinner(d);
    Net.events.on('poker_state', this.onState);
    Net.events.on('poker_over', this.onOver);
    this.events.once('shutdown', () => {
      Net.events.off('poker_state', this.onState);
      Net.events.off('poker_over', this.onOver);
    });

    if (Net.pokerState) this.render(Net.pokerState);
  }

  clearDyn() {
    this.dyn.forEach((o) => o.destroy());
    this.dyn = [];
  }

  // ---- card rendering -------------------------------------------------------

  drawCard(x, y, w, card, faceUp, dim) {
    const h = w * 1.4;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(x - w / 2 - 2, y - h / 2 + 4, w + 4, h + 6, 7);
    if (faceUp) {
      g.fillStyle(dim ? 0xb9bfca : 0xffffff, 1);
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 7);
      this.dyn.push(g);
      const col = isRed(card.suit) ? '#d1324a' : '#12131a';
      this.dyn.push(this.add.text(x - w / 2 + 7, y - h / 2 + 3, card.rank, {
        fontFamily: 'system-ui, sans-serif', fontSize: `${Math.floor(w * 0.36)}px`, fontStyle: 'bold', color: col,
      }).setOrigin(0, 0));
      this.dyn.push(this.add.text(x, y + h * 0.08, SUIT[card.suit], {
        fontFamily: 'system-ui, sans-serif', fontSize: `${Math.floor(w * 0.66)}px`, color: col,
      }).setOrigin(0.5));
    } else {
      g.fillStyle(0x1b2547, 1);
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 7);
      g.lineStyle(2, 0x3a466f, 1);
      g.strokeRoundedRect(x - w / 2 + 5, y - h / 2 + 5, w - 10, h - 10, 5);
      this.dyn.push(g);
    }
  }

  cardSlot(x, y, w) {
    const h = w * 1.4;
    const g = this.add.graphics();
    g.lineStyle(2, 0x1f7a5a, 0.6);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 7);
    this.dyn.push(g);
  }

  // ---- main render ----------------------------------------------------------

  render(state) {
    if (this.over) return;
    if (this.waiting) { this.waiting.destroy(); this.waiting = null; }

    // Sounds on new action / new result.
    if (state.lastAction && state.lastAction.text && state.lastAction.text !== this._prevAction) {
      this._prevAction = state.lastAction.text;
      audio.sfx('card');
    }
    const hr = state.handResult;
    const handKey = hr ? `${state.handNumber}:${(hr.winners || []).map((w) => w.slot + w.amount).join(',')}` : '';
    if (handKey && handKey !== this._prevHandKey) {
      this._prevHandKey = handKey;
      audio.sfx('goal');
    }

    this.clearDyn();
    this.turnEndsAt = state.turnEndsAt || null;
    this.turnMs = state.turnMs || 30000;
    this.activePos = null;

    // Street + pot in the middle of the felt.
    this.dyn.push(this.add.text(TABLE.cx, TABLE.cy - 150, STREET_LABEL[state.street] || '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '26px', color: '#8fd9be',
    }).setOrigin(0.5));
    this.dyn.push(this.add.text(TABLE.cx, TABLE.cy - 112, `POT  ${state.pot}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '46px', fontStyle: 'bold', color: '#ffe08a',
    }).setOrigin(0.5));

    // Community cards row.
    const cw = 96;
    const gap = cw + 20;
    const startX = TABLE.cx - gap * 2;
    for (let i = 0; i < 5; i++) {
      const x = startX + i * gap;
      const card = state.community[i];
      if (card) this.drawCard(x, TABLE.cy - 6, cw, card, true, false);
      else this.cardSlot(x, TABLE.cy - 6, cw);
    }

    // Last-action line below the board.
    const la = state.lastAction;
    if (la && la.text) {
      this.dyn.push(this.add.text(TABLE.cx, TABLE.cy + 118, `${la.name ? la.name + ' ' : ''}${la.text}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '30px', color: '#cfe8dd',
      }).setOrigin(0.5));
    }

    this.drawSeats(state);

    // Showdown / hand result summary banner.
    if (hr && hr.winners && hr.winners.length && state.street === 'handover') {
      const txt = hr.winners.map((w) => `${w.name} +${w.amount}${w.hand ? ' · ' + w.hand : ''}`).join('   ');
      this.dyn.push(this.add.text(TABLE.cx, TABLE.cy + 168, txt, {
        fontFamily: 'system-ui, sans-serif', fontSize: '30px', fontStyle: 'bold', color: '#4ade80',
      }).setOrigin(0.5));
    }
  }

  drawSeats(state) {
    const revealed = (state.handResult && state.handResult.revealed) || {};
    const winnerSlots = new Set(((state.handResult && state.handResult.winners) || []).map((w) => w.slot));
    const n = state.players.length;

    state.players.forEach((p, i) => {
      // Distribute seats around the ring, starting at the bottom.
      const theta = (Math.PI / 2) + (i * 2 * Math.PI) / n;
      const x = TABLE.cx + SEAT.rx * Math.cos(theta);
      const y = TABLE.cy + SEAT.ry * Math.sin(theta);
      const isTurn = p.slot === state.toAct && state.phase === 'playing';
      const folded = p.status === 'folded';
      const out = p.status === 'out';
      const cNum = hexNum(p.color);

      // Hole cards above the info box.
      const showCards = revealed[p.slot];
      const cw = 66;
      if (out) {
        // nothing
      } else if (showCards) {
        this.drawCard(x - cw * 0.58, y - 78, cw, showCards[0], true, false);
        this.drawCard(x + cw * 0.58, y - 78, cw, showCards[1], true, false);
      } else if (p.hasCards) {
        this.drawCard(x - cw * 0.4, y - 78, cw, null, false, folded);
        this.drawCard(x + cw * 0.4, y - 78, cw, null, false, folded);
      }

      // Info box.
      const bw = 224; const bh = 116;
      const box = this.add.rectangle(x, y + 34, bw, bh, isTurn ? 0x18324a : 0x101626, out ? 0.5 : 0.95)
        .setStrokeStyle(isTurn ? 6 : 3, isTurn ? 0xffe08a : cNum, out ? 0.4 : (isTurn ? 1 : 0.7));
      this.dyn.push(box);
      if (winnerSlots.has(p.slot) && state.street === 'handover') {
        this.dyn.push(this.add.rectangle(x, y + 34, bw + 12, bh + 12).setStrokeStyle(5, 0x4ade80, 1));
      }

      const nameColor = out ? '#5b6478' : (p.connected ? '#eef1f7' : '#8b93a7');
      this.dyn.push(this.add.text(x, y + 10, p.name, {
        fontFamily: 'system-ui, sans-serif', fontSize: '27px', fontStyle: 'bold', color: nameColor,
      }).setOrigin(0.5));

      const stackLine = out ? 'OUT' : `${p.stack} chips`;
      this.dyn.push(this.add.text(x, y + 44, stackLine, {
        fontFamily: 'system-ui, sans-serif', fontSize: '23px',
        color: out ? '#8a4b4b' : '#ffe08a', fontStyle: out ? 'bold' : 'normal',
      }).setOrigin(0.5));

      // Status / bet tag.
      let tag = '';
      let tagColor = '#8b93a7';
      if (folded) { tag = 'folded'; }
      else if (p.status === 'allin') { tag = 'ALL-IN'; tagColor = '#ff8f6b'; }
      else if (p.bet > 0) { tag = `bet ${p.bet}`; tagColor = '#9fe3c6'; }
      if (tag) {
        this.dyn.push(this.add.text(x, y + 74, tag, {
          fontFamily: 'system-ui, sans-serif', fontSize: '22px', fontStyle: 'bold', color: tagColor,
        }).setOrigin(0.5));
      }

      // Dealer button + blind badges toward the table centre.
      const bx = x + (TABLE.cx - x) * 0.16;
      const by = y + (TABLE.cy - y) * 0.16 - 40;
      if (p.slot === state.button) this.chip(bx, by, '#ffffff', '#12131a', 'D');
      if (p.slot === state.sb) this.chip(bx, by + 34, '#64d2ff', '#06263a', 'SB');
      if (p.slot === state.bb) this.chip(bx, by + 34, '#ffb84d', '#3a2406', 'BB');

      if (isTurn) this.activePos = { x, y: y + 34, w: bw };
    });
  }

  chip(x, y, fill, textColor, label) {
    const c = this.add.circle(x, y, 17, hexNum(fill)).setStrokeStyle(2, 0x000000, 0.4);
    this.dyn.push(c);
    this.dyn.push(this.add.text(x, y, label, {
      fontFamily: 'system-ui, sans-serif', fontSize: '17px', fontStyle: 'bold', color: textColor,
    }).setOrigin(0.5));
  }

  update() {
    if (this.over || !this.turnBar) return;
    this.turnBar.clear();
    if (this.turnEndsAt && this.activePos) {
      const rem = Math.max(0, this.turnEndsAt - Date.now());
      const frac = Math.max(0, Math.min(1, rem / this.turnMs));
      const { x, y, w } = this.activePos;
      const bw = w - 24;
      this.turnBar.fillStyle(0x0a1220, 1);
      this.turnBar.fillRoundedRect(x - bw / 2, y + 44, bw, 8, 4);
      const col = frac > 0.4 ? 0x4ade80 : (frac > 0.15 ? 0xffe08a : 0xff6b6b);
      this.turnBar.fillStyle(col, 1);
      this.turnBar.fillRoundedRect(x - bw / 2, y + 44, bw * frac, 8, 4);
    }
  }

  showWinner(data) {
    this.over = true;
    audio.sfx('win');
    if (this.turnBar) this.turnBar.clear();
    if (this.waiting) { this.waiting.destroy(); this.waiting = null; }
    this.clearDyn();
    const name = (data && data.winnerName) || 'Nobody';
    this.add.text(DESIGN.W / 2, 400, 'TOURNAMENT OVER', {
      fontFamily: 'system-ui, sans-serif', fontSize: '60px', color: '#8fd9be',
    }).setOrigin(0.5);
    this.add.text(DESIGN.W / 2, 500, `${name} takes it all!`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '92px', fontStyle: 'bold', color: '#e8c15a',
    }).setOrigin(0.5);
    this.add.text(DESIGN.W / 2, 620, 'back to lobby…', {
      fontFamily: 'system-ui, sans-serif', fontSize: '32px', color: '#8b93a7',
    }).setOrigin(0.5);
    this.time.delayedCall(4000, () => this.scene.start('LobbyScene'));
  }
}
