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
