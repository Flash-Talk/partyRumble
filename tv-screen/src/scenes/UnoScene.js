// TV view of an UNO round. Purely renders the server's public state
// (Net.unoState / 'uno_state' events); the server is authoritative.
import Net from '../net.js';
import audio from '../audio.js';
import { DESIGN } from '../config.js';

const COLOR_HEX = { red: '#ef4444', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6' };
const colorHex = (c) => COLOR_HEX[c] || '#9aa4bf';
const colorNum = (c) => parseInt((COLOR_HEX[c] || '#2a3350').slice(1), 16);
function symbolFor(kind) {
  if (/^[0-9]$/.test(kind)) return kind;
  return { skip: 'Ø', reverse: '⇄', draw2: '+2', wild: '★', wild4: '+4' }[kind] || kind;
}

export default class UnoScene extends Phaser.Scene {
  constructor() {
    super('UnoScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');
    audio.music('game');
    this.dyn = [];
    this.over = false;
    this._prevAction = '';

    this.add.text(DESIGN.W / 2, 20, 'UNO', {
      fontFamily: 'system-ui, sans-serif', fontSize: '40px', fontStyle: 'bold', color: '#eab308',
    }).setOrigin(0.5, 0);

    this.waiting = this.add.text(DESIGN.W / 2, DESIGN.H / 2, 'Dealing…', {
      fontFamily: 'system-ui, sans-serif', fontSize: '48px', color: '#8b93a7',
    }).setOrigin(0.5);

    this.onState = (s) => this.render(s);
    this.onOver = (d) => this.showWinner(d);
    Net.events.on('uno_state', this.onState);
    Net.events.on('uno_over', this.onOver);
    this.events.once('shutdown', () => {
      Net.events.off('uno_state', this.onState);
      Net.events.off('uno_over', this.onOver);
    });

    if (Net.unoState) this.render(Net.unoState);
  }

  clearDyn() {
    this.dyn.forEach((o) => o.destroy());
    this.dyn = [];
  }

  addCard(x, y, w, fillNum, symbol, symbolSize) {
    const h = w * 1.42;
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(x - w / 2 - 5, y - h / 2 - 5, w + 10, h + 10, 12);
    g.fillStyle(fillNum, 1);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 10);
    this.dyn.push(g);
    const t = this.add.text(x, y, symbol, {
      fontFamily: 'system-ui, sans-serif', fontSize: `${symbolSize || Math.floor(w * 0.5)}px`,
      fontStyle: 'bold', color: '#ffffff',
    }).setOrigin(0.5);
    this.dyn.push(t);
  }

  render(state) {
    if (this.over) return;
    if (state.lastAction && state.lastAction.text && state.lastAction.text !== this._prevAction) {
      this._prevAction = state.lastAction.text;
      audio.sfx('card');
    }
    if (this.waiting) { this.waiting.destroy(); this.waiting = null; }
    this.clearDyn();

    // Last action line.
    const la = state.lastAction;
    if (la && la.text) {
      this.dyn.push(this.add.text(DESIGN.W / 2, 92, `${la.name ? la.name + ' ' : ''}${la.text}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '34px', color: '#cbd3e6',
      }).setOrigin(0.5));
    }

    const cy = 430;

    // Draw deck (face down) + count.
    this.addCard(810, cy, 150, 0x1b2547, 'UNO', 40);
    this.dyn.push(this.add.text(810, cy + 150, `draw · ${state.drawPileCount}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '26px', color: '#8b93a7',
    }).setOrigin(0.5));

    // Direction arrow.
    this.dyn.push(this.add.text(DESIGN.W / 2, cy, state.direction > 0 ? '↻' : '↺', {
      fontFamily: 'system-ui, sans-serif', fontSize: '72px', color: '#4b557f',
    }).setOrigin(0.5));

    // Discard pile top (wild shows the chosen color).
    const top = state.topCard;
    const fill = top.color === 'wild' ? colorNum(state.currentColor) : colorNum(top.color);
    this.addCard(1110, cy, 170, fill, symbolFor(top.kind));
    this.dyn.push(this.add.text(1110, cy + 165, `color: ${state.currentColor}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '28px', fontStyle: 'bold', color: colorHex(state.currentColor),
    }).setOrigin(0.5));

    // Pending draw warning.
    if (state.pendingDraw > 0) {
      this.dyn.push(this.add.text(1110, cy - 185, `+${state.pendingDraw} — stack or draw!`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '36px', fontStyle: 'bold', color: '#ff6b6b',
      }).setOrigin(0.5));
    }

    // Whose turn.
    const cur = state.players.find((p) => p.slot === state.currentSlot);
    if (cur) {
      this.dyn.push(this.add.text(DESIGN.W / 2, 712, `${cur.name}'s turn`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '46px', fontStyle: 'bold', color: cur.color,
      }).setOrigin(0.5));
    }

    this.drawPlayers(state);
  }

  drawPlayers(state) {
    const n = state.players.length;
    const spacing = Math.min(250, 1720 / n);
    const startX = DESIGN.W / 2 - ((n - 1) * spacing) / 2;
    const y = 850;
    state.players.forEach((p, i) => {
      const x = startX + i * spacing;
      const isTurn = p.slot === state.currentSlot;
      const box = this.add.rectangle(x, y, spacing - 24, 130, isTurn ? 0x1b2547 : 0x121728)
        .setStrokeStyle(isTurn ? 5 : 2, colorNum(p.color), isTurn ? 1 : 0.5);
      this.dyn.push(box);
      this.dyn.push(this.add.rectangle(x, y - 34, 30, 30, colorNum(p.color)));
      this.dyn.push(this.add.text(x, y + 2, p.name, {
        fontFamily: 'system-ui, sans-serif', fontSize: '28px', fontStyle: 'bold',
        color: p.connected ? '#eef1f7' : '#6b7280',
      }).setOrigin(0.5));
      this.dyn.push(this.add.text(x, y + 40, `${p.count} cards`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#8b93a7',
      }).setOrigin(0.5));
    });
  }

  showWinner(data) {
    this.over = true;
    audio.sfx('win');
    if (this.waiting) { this.waiting.destroy(); this.waiting = null; }
    this.clearDyn();
    const name = (data && data.winnerName) || 'Nobody';
    this.add.text(DESIGN.W / 2, 420, 'ROUND OVER', {
      fontFamily: 'system-ui, sans-serif', fontSize: '64px', color: '#8b93a7',
    }).setOrigin(0.5);
    this.add.text(DESIGN.W / 2, 520, `${name} wins!`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '96px', fontStyle: 'bold', color: '#eab308',
    }).setOrigin(0.5);
    this.add.text(DESIGN.W / 2, 640, 'back to lobby…', {
      fontFamily: 'system-ui, sans-serif', fontSize: '32px', color: '#8b93a7',
    }).setOrigin(0.5);
    this.time.delayedCall(3500, () => this.scene.start('LobbyScene'));
  }
}
