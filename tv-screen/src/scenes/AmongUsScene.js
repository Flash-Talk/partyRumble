// TV view of an Among Us round. Renders only the server's public state — it
// never learns who the imposter is.
import Net from '../net.js';
import audio from '../audio.js';
import { DESIGN, hexToNum } from '../config.js';

function darken(hex, f) {
  const n = parseInt(String(hex).replace('#', ''), 16);
  const r = Math.floor(((n >> 16) & 255) * f);
  const g = Math.floor(((n >> 8) & 255) * f);
  const b = Math.floor((n & 255) * f);
  return (r << 16) | (g << 8) | b;
}

export default class AmongUsScene extends Phaser.Scene {
  constructor() {
    super('AmongUsScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');
    this.avatars = new Map();
    this.overlayObjs = [];
    this.sabObjs = [];
    this.mapDrawn = false;
    this.mx = 40;
    this.my = 40;
    this._prevAlive = {};
    this._prevPhase = 'play';
    this._prevVotes = 0;
    audio.music('game');

    this.add.text(DESIGN.W / 2, 6, 'AMONG US — find the imposter', {
      fontFamily: 'system-ui, sans-serif', fontSize: '26px', fontStyle: 'bold', color: '#8b93a7',
    }).setOrigin(0.5, 0).setDepth(30);

    // crew task bar
    this.add.rectangle(DESIGN.W / 2, 58, 560, 24, 0x1a2440).setStrokeStyle(2, 0x2a3350).setDepth(30);
    this.taskBarFill = this.add.rectangle(DESIGN.W / 2 - 278, 58, 556, 18, 0x4ade80).setOrigin(0, 0.5).setDepth(31);
    this.taskBarFill.setScale(0.0001, 1);
    this.taskBarText = this.add.text(DESIGN.W / 2, 58, 'TASKS 0%', {
      fontFamily: 'system-ui, sans-serif', fontSize: '20px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5).setDepth(32);

    // "get ready" intro
    const gr = this.add.text(DESIGN.W / 2, DESIGN.H / 2, 'GET READY', {
      fontFamily: 'system-ui, sans-serif', fontSize: '90px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5).setDepth(45);
    this.tweens.add({ targets: gr, alpha: 0, delay: 1600, duration: 800, onComplete: () => gr.destroy() });

    this.onStart = (map) => this.drawMap(map);
    this.onState = (state) => this.renderState(state);
    this.onOver = (data) => this.showOver(data);
    Net.events.on('amongus_start', this.onStart);
    Net.events.on('amongus_state', this.onState);
    Net.events.on('amongus_over', this.onOver);
    this.events.once('shutdown', () => {
      Net.events.off('amongus_start', this.onStart);
      Net.events.off('amongus_state', this.onState);
      Net.events.off('amongus_over', this.onOver);
    });

    if (Net.amongusMap) this.drawMap(Net.amongusMap);
    if (Net.amongusState) this.renderState(Net.amongusState);
  }

  drawMap(map) {
    if (this.mapDrawn) return;
    this.mapDrawn = true;
    this.mx = Math.round((DESIGN.W - map.w) / 2);
    this.my = Math.round((DESIGN.H - map.h) / 2);
    const g = this.add.graphics().setDepth(0);
    g.fillStyle(0x141a2e, 1);
    g.fillRoundedRect(this.mx, this.my, map.w, map.h, 26);
    g.lineStyle(3, 0x2b3560, 1);
    g.strokeRoundedRect(this.mx, this.my, map.w, map.h, 26);
    g.fillStyle(0x323d63, 1);
    for (const w of map.walls) g.fillRoundedRect(this.mx + w.x, this.my + w.y, w.w, w.h, 8);
    // task stations
    for (const t of map.tasks || []) {
      g.fillStyle(0x3b466f, 1);
      g.fillCircle(this.mx + t.x, this.my + t.y, 16);
      g.lineStyle(3, 0x64d2ff, 0.7);
      g.strokeCircle(this.mx + t.x, this.my + t.y, 16);
    }
    // vents (grated covers)
    for (const v of map.vents || []) {
      const vx = this.mx + v.x, vy = this.my + v.y;
      g.fillStyle(0x241826, 1);
      g.fillRoundedRect(vx - 24, vy - 18, 48, 36, 7);
      g.lineStyle(3, 0x6b3a5a, 1);
      g.strokeRoundedRect(vx - 24, vy - 18, 48, 36, 7);
      g.lineStyle(2, 0x8a4a6a, 1);
      for (let k = -1; k <= 1; k++) g.lineBetween(vx - 15, vy + k * 8, vx + 15, vy + k * 8);
    }
  }

  makeAvatar(color) {
    const c = hexToNum(color);
    const dark = darken(color, 0.6);
    const cont = this.add.container(0, 0).setDepth(10);

    const shadow = this.add.ellipse(0, 34, 50, 15, 0x000000, 0.28);
    const legL = this.add.rectangle(-11, 28, 13, 14, dark).setOrigin(0.5, 0);
    const legR = this.add.rectangle(10, 28, 13, 14, dark).setOrigin(0.5, 0);

    const g = this.add.graphics();
    const body = { tl: 24, tr: 24, bl: 11, br: 11 };
    g.fillStyle(dark, 1); g.fillRoundedRect(-32, -14, 15, 32, 7);      // backpack
    g.fillStyle(c, 1); g.fillRoundedRect(-24, -32, 48, 60, body);       // body
    g.lineStyle(3, dark, 1); g.strokeRoundedRect(-24, -32, 48, 60, body);
    g.fillStyle(0x9ad2ff, 1); g.fillRoundedRect(-4, -20, 28, 15, 8);    // visor
    g.lineStyle(3, dark, 1); g.strokeRoundedRect(-4, -20, 28, 15, 8);
    g.fillStyle(0xffffff, 0.85); g.fillCircle(16, -15, 3);             // visor glint
    const bodyGroup = this.add.container(0, 0, [g]);

    const label = this.add.text(0, 42, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#cbd3e6',
    }).setOrigin(0.5, 0);

    cont.add([shadow, legL, legR, bodyGroup, label]);
    cont.parts = { shadow, legL, legR, bodyGroup, label };
    cont.walkPhase = 0;
    cont.facing = 1;
    cont.prevX = null;
    cont.prevY = null;
    return cont;
  }

  renderState(state) {
    if (this.taskBarFill) {
      const t = state.taskBar || 0;
      this.taskBarFill.scaleX = Math.max(0.0001, t);
      this.taskBarText.setText(`TASKS ${Math.round(t * 100)}%`);
    }

    // audio + kill flash on a fresh death
    for (const p of state.players) {
      if (this._prevAlive[p.id] === undefined) this._prevAlive[p.id] = p.alive;
      if (this._prevAlive[p.id] && !p.alive) { audio.sfx('kill'); this.killFlash(this.mx + p.x, this.my + p.y); }
      this._prevAlive[p.id] = p.alive;
    }
    if (state.phase === 'meeting' && this._prevPhase !== 'meeting') audio.sfx('meeting');
    if (state.phase === 'meeting' && state.meeting) {
      const total = Object.values(state.meeting.tally.counts).reduce((a, b) => a + b, 0) + (state.meeting.tally.skip || 0);
      if (total > this._prevVotes) audio.sfx('ding');
      this._prevVotes = total;
    } else { this._prevVotes = 0; }
    this._prevPhase = state.phase;

    // avatars
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id);
      let av = this.avatars.get(p.id);
      if (!av) { av = this.makeAvatar(p.color); this.avatars.set(p.id, av); }
      const sx = this.mx + p.x, sy = this.my + p.y;

      const dx = av.prevX === null ? 0 : sx - av.prevX;
      const dy = av.prevY === null ? 0 : sy - av.prevY;
      const moving = Math.abs(dx) + Math.abs(dy) > 0.4;
      if (Math.abs(dx) > 0.5) av.facing = dx < 0 ? -1 : 1;
      av.prevX = sx; av.prevY = sy;
      av.setPosition(sx, sy);
      av.parts.bodyGroup.scaleX = av.facing;

      if (moving && p.alive) {
        av.walkPhase += 0.4;
        av.parts.bodyGroup.y = -Math.abs(Math.sin(av.walkPhase) * 3);
        av.parts.legL.y = 28 + Math.max(0, Math.sin(av.walkPhase)) * 5;
        av.parts.legR.y = 28 + Math.max(0, -Math.sin(av.walkPhase)) * 5;
      } else {
        av.parts.bodyGroup.y = 0; av.parts.legL.y = 28; av.parts.legR.y = 28;
      }

      if (p.alive) { av.setAlpha(1); av.parts.label.setText(''); }
      else { av.setAlpha(0.4); av.parts.label.setText(p.name); }
    }
    for (const [id, av] of this.avatars) {
      if (!seen.has(id)) { av.destroy(); this.avatars.delete(id); }
    }

    this.clearSab();
    if (state.phase === 'play' && state.sabotage) this.drawSab(state.sabotage);

    this.clearOverlay();
    if (state.phase === 'meeting' && state.meeting) this.drawMeeting(state.meeting);
    else if (state.phase === 'reveal' && state.result) this.drawReveal(state.result);
  }

  clearSab() { this.sabObjs.forEach((o) => o.destroy()); this.sabObjs = []; }
  pushSab(o) { this.sabObjs.push(o); return o; }

  drawSab(s) {
    const sx = this.mx + s.station.x, sy = this.my + s.station.y;
    if (s.type === 'lights') {
      this.pushSab(this.add.rectangle(DESIGN.W / 2, DESIGN.H / 2, DESIGN.W, DESIGN.H, 0x000000, 0.62).setDepth(16));
      this.pushSab(this.add.text(DESIGN.W / 2, 96, '💡 LIGHTS SABOTAGED — go fix them', {
        fontFamily: 'system-ui, sans-serif', fontSize: '40px', fontStyle: 'bold', color: '#fde047',
      }).setOrigin(0.5).setDepth(48));
    } else {
      const pulse = 0.12 + 0.16 * Math.abs(Math.sin(this.time.now / 200));
      this.pushSab(this.add.rectangle(DESIGN.W / 2, DESIGN.H / 2, DESIGN.W, DESIGN.H, 0xff0000, pulse).setDepth(16));
      this.pushSab(this.add.text(DESIGN.W / 2, 96, `⚠️ REACTOR MELTDOWN — ${s.timeLeft}s`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '48px', fontStyle: 'bold', color: '#ff3b3b',
      }).setOrigin(0.5).setDepth(48));
    }
    this.pushSab(this.add.circle(sx, sy, 42, 0x000000, 0).setStrokeStyle(6, 0xffe066, 1).setDepth(48));
    this.pushSab(this.add.text(sx, sy + 56, 'FIX HERE', {
      fontFamily: 'system-ui, sans-serif', fontSize: '24px', fontStyle: 'bold', color: '#ffe066',
    }).setOrigin(0.5).setDepth(48));
  }

  killFlash(x, y) {
    const c = this.add.circle(x, y, 24, 0xff3b3b, 0.6).setDepth(20);
    this.tweens.add({ targets: c, scale: 4, alpha: 0, duration: 500, onComplete: () => c.destroy() });
  }

  clearOverlay() {
    this.overlayObjs.forEach((o) => o.destroy());
    this.overlayObjs = [];
  }

  push(o) { o.setDepth(51); this.overlayObjs.push(o); return o; }

  drawMeeting(m) {
    const dim = this.add.rectangle(DESIGN.W / 2, DESIGN.H / 2, DESIGN.W, DESIGN.H, 0x05070f, 0.82).setDepth(50);
    this.overlayObjs.push(dim);
    this.push(this.add.text(DESIGN.W / 2, 110, 'EMERGENCY MEETING', {
      fontFamily: 'system-ui, sans-serif', fontSize: '64px', fontStyle: 'bold', color: '#eab308',
    }).setOrigin(0.5));
    if (m.killed) {
      this.push(this.add.text(DESIGN.W / 2, 200, `${m.killed.name} was found KILLED`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '42px', fontStyle: 'bold', color: '#ff6b6b',
      }).setOrigin(0.5));
    }
    this.push(this.add.text(DESIGN.W / 2, 290, `Who is the imposter?     ${m.timeLeft}s`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '36px', color: '#cbd3e6',
    }).setOrigin(0.5));

    const cands = m.candidates || [];
    const n = cands.length;
    const spacing = Math.min(230, 1500 / Math.max(1, n));
    const startX = DESIGN.W / 2 - ((n - 1) * spacing) / 2;
    const y = 560;
    cands.forEach((c, i) => {
      const x = startX + i * spacing;
      this.push(this.add.circle(x, y, 48, hexToNum(c.color)).setStrokeStyle(4, 0xffffff));
      const votes = (m.tally && m.tally.counts && m.tally.counts[c.id]) || 0;
      this.push(this.add.text(x, y + 72, `${votes} vote${votes === 1 ? '' : 's'}`, {
        fontFamily: 'system-ui, sans-serif', fontSize: '28px', color: '#eef1f7',
      }).setOrigin(0.5));
    });
    this.push(this.add.text(DESIGN.W / 2, 770, `Skip: ${(m.tally && m.tally.skip) || 0}`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '30px', color: '#8b93a7',
    }).setOrigin(0.5));
    this.push(this.add.text(DESIGN.W / 2, 840, 'Vote on your phone', {
      fontFamily: 'system-ui, sans-serif', fontSize: '28px', color: '#8b93a7',
    }).setOrigin(0.5));
  }

  drawReveal(r) {
    const dim = this.add.rectangle(DESIGN.W / 2, DESIGN.H / 2, DESIGN.W, DESIGN.H, 0x05070f, 0.82).setDepth(50);
    this.overlayObjs.push(dim);
    if (r.skipped) {
      this.push(this.add.text(DESIGN.W / 2, DESIGN.H / 2, 'No one was ejected', {
        fontFamily: 'system-ui, sans-serif', fontSize: '60px', fontStyle: 'bold', color: '#cbd3e6',
      }).setOrigin(0.5));
      return;
    }
    this.push(this.add.circle(DESIGN.W / 2, 430, 60, hexToNum(r.ejectedColor)).setStrokeStyle(5, 0xffffff));
    this.push(this.add.text(DESIGN.W / 2, 540, `${r.ejectedName} was ejected`, {
      fontFamily: 'system-ui, sans-serif', fontSize: '58px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5));
    this.push(this.add.text(DESIGN.W / 2, 620, r.wasImposter ? 'They WERE the imposter! 🎉' : 'They were NOT the imposter.', {
      fontFamily: 'system-ui, sans-serif', fontSize: '40px', fontStyle: 'bold',
      color: r.wasImposter ? '#4ade80' : '#ff6b6b',
    }).setOrigin(0.5));
  }

  showOver(data) {
    audio.sfx(data && data.winner === 'imposter' ? 'lose' : 'win');
    const msg = data && data.winner === 'imposter' ? 'IMPOSTER WINS'
      : data && data.winner === 'crew' ? 'CREW WINS' : 'ROUND OVER';
    this.add.rectangle(DESIGN.W / 2, DESIGN.H / 2, DESIGN.W, 200, 0x0a0e1a, 0.85).setDepth(40);
    this.add.text(DESIGN.W / 2, DESIGN.H / 2, msg, {
      fontFamily: 'system-ui, sans-serif', fontSize: '90px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5).setDepth(41);
    this.time.delayedCall(3500, () => this.scene.start('LobbyScene'));
  }
}
