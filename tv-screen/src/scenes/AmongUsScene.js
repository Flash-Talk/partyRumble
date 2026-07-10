// TV view of an Among Us round (Phase 1: map + anonymous moving characters).
// Renders only the server's public state — it never learns who the imposter is.
import Net from '../net.js';
import { DESIGN, hexToNum } from '../config.js';

const MX = 160; // map-space -> screen offset (map is 1600x1000, centered in 1920x1080)
const MY = 40;

export default class AmongUsScene extends Phaser.Scene {
  constructor() {
    super('AmongUsScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');
    this.avatars = new Map();
    this.overlayObjs = [];
    this.mapDrawn = false;

    this.add.text(DESIGN.W / 2, 8, 'AMONG US — find the imposter', {
      fontFamily: 'system-ui, sans-serif', fontSize: '30px', fontStyle: 'bold', color: '#8b93a7',
    }).setOrigin(0.5, 0).setDepth(30);

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
    const g = this.add.graphics().setDepth(0);
    // floor
    g.fillStyle(0x141a2e, 1);
    g.fillRoundedRect(MX, MY, map.w, map.h, 24);
    g.lineStyle(3, 0x263056, 1);
    g.strokeRoundedRect(MX, MY, map.w, map.h, 24);
    // walls
    g.fillStyle(0x2a3350, 1);
    for (const w of map.walls) g.fillRoundedRect(MX + w.x, MY + w.y, w.w, w.h, 8);
    // task stations (decorative for now)
    g.fillStyle(0x3b466f, 1);
    for (const t of map.tasks || []) g.fillCircle(MX + t.x, MY + t.y, 14);
  }

  makeAvatar(color) {
    const c = hexToNum(color);
    const cont = this.add.container(0, 0).setDepth(10);
    const backpack = this.add.ellipse(-16, 2, 16, 30, c).setAlpha(0.9);
    const body = this.add.ellipse(0, 0, 44, 52, c);
    const visor = this.add.ellipse(6, -8, 26, 15, 0xa5d8ff).setStrokeStyle(2, 0x2b3a55);
    const label = this.add.text(0, 40, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5, 0);
    cont.add([backpack, body, visor, label]);
    cont.label = label;
    cont.body2 = body;
    cont.visor = visor;
    cont.pack = backpack;
    return cont;
  }

  renderState(state) {
    const seen = new Set();
    for (const p of state.players) {
      seen.add(p.id);
      let av = this.avatars.get(p.id);
      if (!av) { av = this.makeAvatar(p.color); this.avatars.set(p.id, av); }
      av.setPosition(MX + p.x, MY + p.y);

      if (p.alive) {
        av.setAlpha(1);
        av.label.setText('');           // anonymous while alive
        av.body2.setAngle(0);
      } else {
        av.setAlpha(0.55);
        av.body2.setAngle(90);           // fallen
        av.visor.setVisible(false);
        av.label.setText(`${p.name}\nKILLED`);
        av.label.setColor('#ff6b6b');
      }
    }
    // drop avatars for players who left
    for (const [id, av] of this.avatars) {
      if (!seen.has(id)) { av.destroy(); this.avatars.delete(id); }
    }

    // meeting / reveal overlays
    this.clearOverlay();
    if (state.phase === 'meeting' && state.meeting) this.drawMeeting(state.meeting);
    else if (state.phase === 'reveal' && state.result) this.drawReveal(state.result);
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
    const msg = data && data.winner === 'imposter' ? 'IMPOSTER WINS'
      : data && data.winner === 'crew' ? 'CREW WINS' : 'ROUND OVER';
    this.add.rectangle(DESIGN.W / 2, DESIGN.H / 2, DESIGN.W, 200, 0x0a0e1a, 0.85).setDepth(40);
    this.add.text(DESIGN.W / 2, DESIGN.H / 2, msg, {
      fontFamily: 'system-ui, sans-serif', fontSize: '90px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5).setDepth(41);
    this.time.delayedCall(3500, () => this.scene.start('LobbyScene'));
  }
}
