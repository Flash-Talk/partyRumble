// Shows the room code + QR, lists joined players, and starts the match when
// any player presses SHOOT (>= MIN_PLAYERS present).
import Net from '../net.js';
import { DESIGN, CONFIG, SLOT_ORDER, SLOT_META, hexToNum } from '../config.js';

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super('LobbyScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');
    this.prevAnyShoot = true; // ignore a shoot already held from the previous screen
    this.counting = false;
    this.spaceKey = this.input.keyboard.addKey('SPACE'); // solo/dev start

    this.add.text(DESIGN.W / 2, 90, 'PENALTY RUMBLE', {
      fontFamily: 'system-ui, sans-serif', fontSize: '84px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5);
    this.add.text(DESIGN.W / 2, 165, '4-way free-for-all — defend your goal, score on everyone else', {
      fontFamily: 'system-ui, sans-serif', fontSize: '30px', color: '#8b93a7',
    }).setOrigin(0.5);

    // Room code + QR (left side)
    this.add.text(360, 300, 'ROOM CODE', {
      fontFamily: 'system-ui, sans-serif', fontSize: '32px', color: '#8b93a7',
    }).setOrigin(0.5);
    this.add.text(360, 400, Net.roomCode || '----', {
      fontFamily: 'system-ui, sans-serif', fontSize: '150px', fontStyle: 'bold', color: '#64d2ff',
    }).setOrigin(0.5);

    this.drawQR(Net.joinUrl(), 360, 560, 300);
    this.add.text(360, 900, 'Scan to join, or open the code on your phone', {
      fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#8b93a7',
    }).setOrigin(0.5).setWordWrapWidth(560);

    // Player slots (right side)
    this.slotTexts = {};
    const px = 1180;
    this.add.text(px, 300, 'PLAYERS', {
      fontFamily: 'system-ui, sans-serif', fontSize: '32px', color: '#8b93a7',
    }).setOrigin(0, 0.5);

    SLOT_ORDER.forEach((slot, i) => {
      const y = 380 + i * 110;
      const meta = SLOT_META[slot];
      this.add.rectangle(px + 30, y, 44, 44, hexToNum(meta.color)).setOrigin(0.5);
      const t = this.add.text(px + 80, y, '', {
        fontFamily: 'system-ui, sans-serif', fontSize: '40px', color: '#eef1f7',
      }).setOrigin(0, 0.5);
      this.slotTexts[slot] = t;
    });

    this.startHint = this.add.text(DESIGN.W / 2, 980, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '40px', fontStyle: 'bold', color: '#4ade80',
    }).setOrigin(0.5);

    this.refreshRoster();
    this.onPlayersChanged = () => this.refreshRoster();
    Net.events.on('players_changed', this.onPlayersChanged);
    this.events.once('shutdown', () => Net.events.off('players_changed', this.onPlayersChanged));
  }

  refreshRoster() {
    SLOT_ORDER.forEach((slot) => {
      const meta = SLOT_META[slot];
      const p = Net.players.get(slot);
      const t = this.slotTexts[slot];
      if (p) { t.setText(`${p.name}  (${meta.side})`); t.setColor('#eef1f7'); }
      else { t.setText(`— waiting (${meta.side}) —`); t.setColor('#3a466f'); }
    });

    const count = Net.players.size;
    if (this.counting) return;
    this.startHint.setText(count >= CONFIG.MIN_PLAYERS
      ? 'Press SHOOT on any phone to START'
      : `Waiting for players… (need at least ${CONFIG.MIN_PLAYERS})`);
    this.startHint.setColor(count >= CONFIG.MIN_PLAYERS ? '#4ade80' : '#8b93a7');
  }

  update() {
    // Rising-edge SHOOT (any player) or keyboard SPACE starts the match.
    let anyShoot = this.spaceKey.isDown;
    for (const slot of Net.players.keys()) if (Net.getInput(slot).shoot) anyShoot = true;

    if (!this.counting && anyShoot && !this.prevAnyShoot && Net.players.size >= CONFIG.MIN_PLAYERS) {
      this.startCountdown();
    }
    this.prevAnyShoot = anyShoot;
  }

  startCountdown() {
    this.counting = true;
    let n = 3;
    this.startHint.setColor('#eef1f7');
    const tick = () => {
      if (Net.players.size < CONFIG.MIN_PLAYERS) { // someone bailed
        this.counting = false;
        this.refreshRoster();
        return;
      }
      if (n <= 0) { this.scene.start('GameScene'); return; }
      this.startHint.setText(`Starting in ${n}…`);
      n -= 1;
      this.time.delayedCall(700, tick);
    };
    tick();
  }

  drawQR(url, cxPos, cyPos, size) {
    // qrcode-generator is a global (vendored). Draw modules as rects so the QR
    // scales with the canvas under Scale.FIT.
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const count = qr.getModuleCount();
    const cell = size / count;
    const left = cxPos - size / 2;
    const top = cyPos - size / 2;
    const quiet = 14;

    const g = this.add.graphics();
    g.fillStyle(0xffffff, 1);
    g.fillRect(left - quiet, top - quiet, size + quiet * 2, size + quiet * 2);
    g.fillStyle(0x000000, 1);
    for (let r = 0; r < count; r++) {
      for (let c = 0; c < count; c++) {
        if (qr.isDark(r, c)) g.fillRect(left + c * cell, top + r * cell, cell + 0.6, cell + 0.6);
      }
    }
  }
}
