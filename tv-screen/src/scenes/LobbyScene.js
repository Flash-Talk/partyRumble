// Shows how to join (URL + big room code, QR as a bonus), lists joined players
// (up to 8), and starts the match when any player presses SHOOT.
import Net from '../net.js';
import { DESIGN, CONFIG, SLOT_ORDER, SLOT_META, hexToNum } from '../config.js';

export default class LobbyScene extends Phaser.Scene {
  constructor() {
    super('LobbyScene');
  }

  create() {
    this.cameras.main.setBackgroundColor('#0a0e1a');
    this.prevAnyShoot = true; // ignore a shoot already held from a previous screen
    this.counting = false;
    this.spaceKey = this.input.keyboard.addKey('SPACE');

    this.add.text(DESIGN.W / 2, 70, 'PENALTY RUMBLE', {
      fontFamily: 'system-ui, sans-serif', fontSize: '78px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5);
    this.add.text(DESIGN.W / 2, 138, '2–8 players · defend your goal, score on everyone else', {
      fontFamily: 'system-ui, sans-serif', fontSize: '28px', color: '#8b93a7',
    }).setOrigin(0.5);

    // ---- JOIN block (left): URL + big code are the heroes ----
    const jx = 560;
    const host = window.location.host || window.location.origin.replace(/^https?:\/\//, '');
    this.add.text(jx, 235, 'ON YOUR PHONE, GO TO', {
      fontFamily: 'system-ui, sans-serif', fontSize: '28px', color: '#8b93a7',
    }).setOrigin(0.5);
    this.add.text(jx, 292, host, {
      fontFamily: 'system-ui, sans-serif', fontSize: '46px', fontStyle: 'bold', color: '#64d2ff',
    }).setOrigin(0.5).setWordWrapWidth(1000);

    this.add.text(jx, 388, 'AND ENTER CODE', {
      fontFamily: 'system-ui, sans-serif', fontSize: '28px', color: '#8b93a7',
    }).setOrigin(0.5);
    this.add.text(jx, 500, Net.roomCode || '----', {
      fontFamily: 'system-ui, sans-serif', fontSize: '168px', fontStyle: 'bold', color: '#eef1f7',
    }).setOrigin(0.5);

    this.drawQR(Net.joinUrl(), jx, 760, 220);
    this.add.text(jx, 900, '…or scan this to jump straight in', {
      fontFamily: 'system-ui, sans-serif', fontSize: '24px', color: '#8b93a7',
    }).setOrigin(0.5);

    // ---- PLAYERS block (right) ----
    const px = 1180;
    this.add.text(px, 232, 'PLAYERS', {
      fontFamily: 'system-ui, sans-serif', fontSize: '30px', color: '#8b93a7',
    }).setOrigin(0, 0.5);

    this.slotTexts = {};
    SLOT_ORDER.forEach((slot, i) => {
      const y = 300 + i * 78;
      this.add.rectangle(px + 22, y, 40, 40, hexToNum(SLOT_META[slot].color)).setOrigin(0.5);
      const t = this.add.text(px + 62, y, '', {
        fontFamily: 'system-ui, sans-serif', fontSize: '36px', color: '#eef1f7',
      }).setOrigin(0, 0.5);
      this.slotTexts[slot] = t;
    });

    this.startHint = this.add.text(DESIGN.W / 2, 1012, '', {
      fontFamily: 'system-ui, sans-serif', fontSize: '38px', fontStyle: 'bold', color: '#4ade80',
    }).setOrigin(0.5);

    this.refreshRoster();
    this.onPlayersChanged = () => this.refreshRoster();
    Net.events.on('players_changed', this.onPlayersChanged);
    this.events.once('shutdown', () => Net.events.off('players_changed', this.onPlayersChanged));
  }

  refreshRoster() {
    SLOT_ORDER.forEach((slot) => {
      const p = Net.players.get(slot);
      const t = this.slotTexts[slot];
      if (p) { t.setText(p.name); t.setColor('#eef1f7'); }
      else { t.setText('open'); t.setColor('#3a466f'); }
    });

    if (this.counting) return;
    const count = Net.players.size;
    this.startHint.setText(count >= CONFIG.MIN_PLAYERS
      ? 'Press SHOOT on any phone to START'
      : `Waiting for players… (need at least ${CONFIG.MIN_PLAYERS})`);
    this.startHint.setColor(count >= CONFIG.MIN_PLAYERS ? '#4ade80' : '#8b93a7');
  }

  update() {
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
    const tick = () => {
      if (Net.players.size < CONFIG.MIN_PLAYERS) { this.counting = false; this.refreshRoster(); return; }
      if (n <= 0) { this.scene.start('GameScene'); return; }
      this.startHint.setText(`Starting in ${n}…`).setColor('#eef1f7');
      n -= 1;
      this.time.delayedCall(700, tick);
    };
    tick();
  }

  drawQR(url, cxPos, cyPos, size) {
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const count = qr.getModuleCount();
    const cell = size / count;
    const left = cxPos - size / 2;
    const top = cyPos - size / 2;
    const quiet = 12;

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
