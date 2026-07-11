// TV view of an Indian Rummy game. Renders the server's public state
// (Net.rummyState / 'rummy_state'); the server is authoritative. Hands are
// private and never shown here.
import Net from '../net.js';
import audio from '../audio.js';
import { DESIGN } from '../config.js';

const SUIT = { s: '♠', h: '♥', d: '♦', c: '♣' };
const isRed = (suit) => suit === 'h' || suit === 'd';
const hexNum = (hex) => parseInt(String(hex).replace('#', ''), 16);

const CENTER = { x: 960, y: 470 };
const SEAT = { rx: 720, ry: 372 };

export default class RummyScene extends Phaser.Scene {
  constructor() { super('RummyScene'); }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');
    audio.music('game');
    this.dyn = [];
    this.over = false;
    this._prevAction = '';
    this._prevDeal = '';
    this.turnEndsAt = null;
    this.turnMs = 45000;
    this.activePos = null;

    const felt = this.add.graphics();
    felt.fillStyle(0x13324a, 1);
    felt.fillEllipse(CENTER.x, CENTER.y, 1160, 620);
    felt.lineStyle(8, 0x0c2233, 1);
    felt.strokeEllipse(CENTER.x, CENTER.y, 1160, 620);

    this.add.text(DESIGN.W / 2, 24, 'RUMMY', {
      fontFamily: 'system-ui, sans-serif', fontSize: '38px', fontStyle: 'bold', color: '#64d2ff',
    }).setOrigin(0.5, 0);

    this.turnBar = this.add.graphics();
    this.waiting = this.add.text(CENTER.x, CENTER.y, 'Dealing…', {
      fontFamily: 'system-ui, sans-serif', fontSize: '44px', color: '#cfe1ee',
    }).setOrigin(0.5);

    this.onState = (s) => this.render(s);
    this.onOver = (d) => this.showWinner(d);
    Net.events.on('rummy_state', this.onState);
    Net.events.on('rummy_over', this.onOver);
    this.events.once('shutdown', () => {
      Net.events.off('rummy_state', this.onState);
      Net.events.off('rummy_over', this.onOver);
    });

    if (Net.rummyState) this.render(Net.rummyState);
  }

  clearDyn() { this.dyn.forEach((o) => o.destroy()); this.dyn = []; }

  drawCard(x, y, w, card, faceUp) {
    const h = w * 1.4;
    const g = this.add.graphics();
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(x - w / 2 - 2, y - h / 2 + 4, w + 4, h + 6, 7);
    if (faceUp && card && !card.joker) {
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 7);
      this.dyn.push(g);
      const col = isRed(card.suit) ? '#d1324a' : '#12131a';
      this.dyn.push(this.add.text(x - w / 2 + 7, y - h / 2 + 3, card.rank, {
        fontFamily: 'system-ui, sans-serif', fontSize: `${Math.floor(w * 0.36)}px`, fontStyle: 'bold', color: col,
      }).setOrigin(0, 0));
      this.dyn.push(this.add.text(x, y + h * 0.08, SUIT[card.suit], {
        fontFamily: 'system-ui, sans-serif', fontSize: `${Math.floor(w * 0.66)}px`, color: col,
      }).setOrigin(0.5));
    } else if (faceUp && card && card.joker) {
      g.fillStyle(0xffffff, 1);
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 7);
      this.dyn.push(g);
      this.dyn.push(this.add.text(x, y, '🃏', { fontSize: `${Math.floor(w * 0.7)}px` }).setOrigin(0.5));
    } else {
      g.fillStyle(0x1b2547, 1);
      g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 7);
      g.lineStyle(2, 0x3a466f, 1);
      g.strokeRoundedRect(x - w / 2 + 5, y - h / 2 + 5, w - 10, h - 10, 5);
      this.dyn.push(g);
    }
  }

  render(state) {
    if (this.over) return;
    if (this.waiting) { this.waiting.destroy(); this.waiting = null; }

    if (state.lastAction && state.lastAction.text && state.lastAction.text !== this._prevAction) {
      this._prevAction = state.lastAction.text;
      audio.sfx('card');
    }
    const dealKey = state.lastDeal ? `${state.dealNumber}:${state.lastDeal.declarer}` : '';
    if (dealKey && dealKey !== this._prevDeal) { this._prevDeal = dealKey; audio.sfx('ding'); }

    this.clearDyn();
    this.turnEndsAt = state.turnEndsAt || null;
    this.turnMs = state.turnMs || 45000;
    this.activePos = null;

    // Centre: wild joker (prominent), closed stock, open discard.
    this.dyn.push(this.add.text(CENTER.x, CENTER.y - 168, `WILD JOKER: ${state.wildRank || '—'}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#ffe08a',
    }).setOrigin(0.5));
    this.drawCard(CENTER.x, CENTER.y - 40, 108, state.wildCard, true);
    this.dyn.push(this.add.rectangle(CENTER.x, CENTER.y - 40, 122, 165).setStrokeStyle(4, 0xffe08a, 0.9));

    this.drawCard(CENTER.x - 210, CENTER.y - 40, 96, null, false);
    this.dyn.push(this.add.text(CENTER.x - 210, CENTER.y + 60, `stock · ${state.stockCount}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#8fb7d6',
    }).setOrigin(0.5));

    this.drawCard(CENTER.x + 210, CENTER.y - 40, 96, state.discardTop, true);
    this.dyn.push(this.add.text(CENTER.x + 210, CENTER.y + 60, 'discard', {
      fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#8fb7d6',
    }).setOrigin(0.5));

    const la = state.lastAction;
    if (la && la.text) {
      this.dyn.push(this.add.text(CENTER.x, CENTER.y + 118, `${la.name ? la.name + ' ' : ''}${la.text}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '28px', color: '#cfe1ee',
      }).setOrigin(0.5));
    }

    this.drawSeats(state);

    // Deal-result panel.
    if (state.phase === 'dealover' && state.lastDeal) {
      const d = state.lastDeal;
      const parts = state.players
        .filter((p) => d.scores[p.slot] != null)
        .map((p) => `${p.name} +${d.scores[p.slot]}`);
      this.dyn.push(this.add.text(CENTER.x, CENTER.y + 158, `${d.declarerName || 'Someone'} declared!  ${parts.join('   ')}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '28px', fontStyle: 'bold', color: '#4ade80',
      }).setOrigin(0.5));
    }
  }

  drawSeats(state) {
    const n = state.players.length;
    state.players.forEach((p, i) => {
      const theta = (Math.PI / 2) + (i * 2 * Math.PI) / n;
      const x = CENTER.x + SEAT.rx * Math.cos(theta);
      const y = CENTER.y + SEAT.ry * Math.sin(theta);
      const isTurn = p.slot === state.turn;
      const out = p.status === 'out';
      const cNum = hexNum(p.color);

      const bw = 232; const bh = 118;
      const box = this.add.rectangle(x, y, bw, bh, isTurn ? 0x16344c : 0x101626, out ? 0.5 : 0.95)
        .setStrokeStyle(isTurn ? 6 : 3, isTurn ? 0xffe08a : cNum, out ? 0.4 : (isTurn ? 1 : 0.7));
      this.dyn.push(box);

      this.dyn.push(this.add.text(x, y - 28, p.name, {
        fontFamily: 'system-ui, sans-serif', fontSize: '27px', fontStyle: 'bold',
        color: out ? '#5b6478' : (p.connected ? '#eef1f7' : '#8b93a7'),
      }).setOrigin(0.5));
      this.dyn.push(this.add.text(x, y + 6, out ? 'ELIMINATED' : `${p.count} cards`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '22px',
        color: out ? '#c06b6b' : '#8fb7d6', fontStyle: out ? 'bold' : 'normal',
      }).setOrigin(0.5));
      this.dyn.push(this.add.text(x, y + 36, `${p.score} / ${state.poolLimit}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '23px', fontStyle: 'bold',
        color: p.score >= state.poolLimit ? '#ff6b6b' : '#ffe08a',
      }).setOrigin(0.5));

      if (isTurn) this.activePos = { x, y, w: bw };
    });
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
      this.turnBar.fillRoundedRect(x - bw / 2, y + 46, bw, 8, 4);
      const col = frac > 0.4 ? 0x4ade80 : (frac > 0.15 ? 0xffe08a : 0xff6b6b);
      this.turnBar.fillStyle(col, 1);
      this.turnBar.fillRoundedRect(x - bw / 2, y + 46, bw * frac, 8, 4);
    }
  }

  showWinner(data) {
    this.over = true;
    audio.sfx('win');
    if (this.turnBar) this.turnBar.clear();
    if (this.waiting) { this.waiting.destroy(); this.waiting = null; }
    this.clearDyn();
    const name = (data && data.winnerName) || 'Nobody';
    this.add.text(DESIGN.W / 2, 400, 'GAME OVER', {
      fontFamily: 'system-ui, sans-serif', fontSize: '60px', color: '#8fb7d6',
    }).setOrigin(0.5);
    this.add.text(DESIGN.W / 2, 500, `${name} wins!`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '92px', fontStyle: 'bold', color: '#64d2ff',
    }).setOrigin(0.5);
    this.add.text(DESIGN.W / 2, 620, 'back to lobby…', {
      fontFamily: 'system-ui, sans-serif', fontSize: '32px', color: '#8b93a7',
    }).setOrigin(0.5);
    this.time.delayedCall(4000, () => this.scene.start('LobbyScene'));
  }
}
